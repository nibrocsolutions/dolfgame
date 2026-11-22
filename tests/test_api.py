import pytest
from fastapi.testclient import TestClient

from app.course import HOLES


@pytest.fixture()
def client():
    from app.database import Base, engine
    from app.main import app

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as test_client:
        yield test_client


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_a_player_can_resume_the_same_round(client):
    created = client.post("/api/players", json={"name": "Ada"})
    assert created.status_code == 201
    player_id = created.json()["id"]
    first = client.post("/api/rounds", json={"player_id": player_id})
    assert first.status_code == 201
    assert first.json()["resumed"] is False
    assert first.json()["view"]["hole"]["number"] == 1
    assert len(first.json()["view"]["card"]) == 18
    again = client.post("/api/rounds", json={"player_id": player_id})
    assert again.json()["resumed"] is True
    assert again.json()["round"]["id"] == first.json()["round"]["id"]
    home = client.get("/api/home", params={"player_id": player_id}).json()
    assert home["active"]["id"] == first.json()["round"]["id"]
    assert home["course"]["par"] == 61
    brands = {disc["brand"] for disc in home["bag"]}
    assert brands == {"Innova", "MVP"}


def test_the_same_name_comes_back(client):
    first = client.post("/api/players", json={"name": "Ada"})
    assert first.status_code == 201
    again = client.post("/api/players", json={"name": " ada "})
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["name"] == "Ada"


def test_the_home_line_carries_the_grip(client):
    script = client.get("/static/js/app.js").text
    sentence = "Eighteen holes, each one its own shape. Aim with the stick. Throw."
    after = script.split(sentence, 1)[1][:220]
    assert "(Grip it and Rip it!)" in after


def test_admin_lists_players_and_replaces_the_course(client):
    created = client.post("/api/players", json={"name": "Ada"})
    player_id = created.json()["id"]
    client.post("/api/rounds", json={"player_id": player_id})
    page = client.get("/admin")
    assert page.status_code == 200
    assert "Export" in page.text
    assert "Import" in page.text
    assert "/static/js/admin.js" in page.text
    roster = client.get("/api/admin/players").json()
    assert roster["summary"]["players"] == 1
    assert roster["summary"]["open_rounds"] == 1
    assert roster["players"][0]["name"] == "Ada"
    assert roster["players"][0]["active"]["hole"] == 1
    exported = client.get("/api/admin/export")
    assert exported.status_code == 200
    assert "chainline-backup.json" in exported.headers["content-disposition"]
    backup = exported.json()
    assert backup["app"] == "chainline"
    assert backup["players"][0]["id"] == player_id
    assert backup["rounds"][0]["player_id"] == player_id
    refused = client.post("/api/admin/import", json={"app": "chainline", "players": [{"id": 1, "name": "Zoe"}], "rounds": [{"id": 1, "player_id": 1, "state_json": "nope"}]})
    assert refused.status_code == 400
    assert client.get("/api/players").json()[0]["name"] == "Ada"
    other = {
        "app": "chainline",
        "players": [{
            "id": 7,
            "name": "Bea",
            "rounds_played": 2,
            "best_strokes": 58,
            "best_to_par": -3,
            "aces": 1,
            "birdies": 4,
            "created_at": "2026-01-01T00:00:00+00:00",
        }],
        "rounds": [],
    }
    imported = client.post("/api/admin/import", json=other)
    assert imported.status_code == 200
    assert imported.json() == {"ok": True, "players": 1, "rounds": 0}
    listed = client.get("/api/players").json()
    assert listed[0]["id"] == 7
    assert listed[0]["best_label"] == "-3"
    restored = client.post("/api/admin/import", json=backup)
    assert restored.status_code == 200
    home = client.get("/api/home", params={"player_id": player_id}).json()
    assert home["player"]["name"] == "Ada"
    assert home["active"]["hole"] == 1


def test_the_finished_card_scrolls_and_can_be_finished(client):
    script = client.get("/static/js/app.js").text
    css = client.get("/static/css/app.css").text
    assert "Finish the round" in script
    assert "sheet-scroll" in script
    assert "sheet-scroll" in css
    assert 'closest("#veil")' in script


def test_the_page_says_throw(client):
    page = client.get("/").text
    script = client.get("/static/js/app.js").text
    assert "Chainline" in page
    assert "Throw" in script
    assert "shoot" not in script.lower()
    assert "Fire" not in script


def test_play_socket_throws_the_disc(client):
    player_id = client.post("/api/players", json={"name": "Bea"}).json()["id"]
    round_id = client.post("/api/rounds", json={"player_id": player_id}).json()["round"]["id"]
    with client.websocket_connect(f"/api/rounds/{round_id}/play?player_id={player_id}") as socket:
        hello = socket.receive_json()
        assert hello["strokes"] == 0
        socket.send_json({"cmd": "input", "aim": [0, -1], "power": 1, "pressed": ["shoot"], "disc": "mako3", "release": "flat"})
        ignored = socket.receive_json()
        assert ignored["strokes"] == 0
        socket.send_json({"cmd": "input", "aim": [0, -1], "power": 1, "pressed": ["throw"], "disc": "mako3", "release": "flat"})
        thrown = socket.receive_json()
    assert thrown["strokes"] >= 1
    assert thrown["last_throw"]["result"] in {"safe", "chains", "tree", "water", "ob"}
    assert thrown["lie"][1] > hello["lie"][1] or thrown["status"] == "holed"


def test_leaving_a_finished_hole_still_walks_on(client, monkeypatch):
    basket = HOLES[0]["basket"]

    def land_close(*_args, **_kwargs):
        return {
            "samples": [[0, 0, 1], [basket[0] + 0.4, basket[1], 0]],
            "events": [],
            "result": "safe",
            "x": basket[0] + 0.4,
            "y": basket[1],
            "hit_tree": False,
            "dt": 0.06,
            "seconds": 0.4,
        }

    monkeypatch.setattr("app.game.simulate", land_close)
    player_id = client.post("/api/players", json={"name": "Cara"}).json()["id"]
    round_id = client.post("/api/rounds", json={"player_id": player_id}).json()["round"]["id"]
    with client.websocket_connect(f"/api/rounds/{round_id}/play?player_id={player_id}") as socket:
        socket.receive_json()
        socket.send_json({"cmd": "input", "aim": [0, -1], "power": 0.4, "pressed": ["throw"], "disc": "aviar", "release": "flat"})
        holed = socket.receive_json()
    assert holed["status"] == "holed"
    assert holed["hole"]["number"] == 1
    resumed = client.post("/api/rounds", json={"player_id": player_id}).json()
    assert resumed["resumed"] is True
    assert resumed["view"]["status"] == "holed"
    assert resumed["view"]["hole"]["number"] == 1
    with client.websocket_connect(f"/api/rounds/{round_id}/play?player_id={player_id}") as socket:
        hello = socket.receive_json()
        assert hello["status"] == "holed"
        socket.send_json({"cmd": "next"})
        walked = socket.receive_json()
    assert walked["status"] == "playing"
    assert walked["hole"]["number"] == 2
    assert walked["strokes"] == 0


def test_a_rounds_number_opens_every_round_and_its_card(client):
    import json

    from app.database import SessionLocal
    from app.game import dump_state
    from app.models import Round

    player_id = client.post("/api/players", json={"name": "Ada"}).json()["id"]
    started = client.post("/api/rounds", json={"player_id": player_id}).json()
    round_id = started["round"]["id"]
    db = SessionLocal()
    record = db.get(Round, round_id)
    state = json.loads(record.state_json)
    state["scores"] = [3] * 18
    state["status"] = "finished"
    state["hole"] = 17
    record.state_json = dump_state(state)
    record.status = "finished"
    db.commit()
    db.close()
    saved = client.post(f"/api/rounds/{round_id}/resolve", params={"player_id": player_id})
    assert saved.status_code == 200
    fresh = client.post("/api/rounds", json={"player_id": player_id, "fresh": True})
    assert fresh.status_code == 201
    open_id = fresh.json()["round"]["id"]

    listed = client.get(f"/api/players/{player_id}/rounds")
    assert listed.status_code == 200
    body = listed.json()
    assert body["player"] == {"id": player_id, "name": "Ada", "rounds_played": 1}
    assert [row["id"] for row in body["rounds"]] == [open_id, round_id]
    assert body["rounds"][0]["label"] == "On the course"
    assert body["rounds"][0]["holes"] == 0
    assert body["rounds"][0]["score"] is None
    saved_row = body["rounds"][1]
    assert saved_row["label"] == "Saved"
    assert saved_row["holes"] == 18
    assert saved_row["score"] == 54
    assert saved_row["to_par_label"] == "-7"

    card = client.get(f"/api/rounds/{round_id}/card", params={"player_id": player_id})
    assert card.status_code == 200
    shown = card.json()
    assert shown["player"] == "Ada"
    assert len(shown["card"]) == 18
    assert shown["card"][0]["number"] == 1
    assert shown["card"][0]["score"] == 3
    assert shown["card"][0]["par"] == HOLES[0]["par"]
    assert shown["card"][17]["score"] == 3
    assert shown["total_strokes"] == 54
    other = client.post("/api/players", json={"name": "Bea"}).json()["id"]
    assert client.get(f"/api/rounds/{round_id}/card", params={"player_id": other}).status_code == 404

    home = client.get("/static/js/app.js").text
    assert 'id="rounds"' in home
    assert "/card?player_id=" in home
    admin = client.get("/static/js/admin.js").text
    assert "data-player" in admin
    assert "/card?player_id=" in admin
    page = client.get("/admin").text
    assert "The saved number opens" in page
