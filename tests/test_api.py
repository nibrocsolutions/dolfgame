import pytest
from fastapi.testclient import TestClient


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


def test_duplicate_names_are_refused(client):
    assert client.post("/api/players", json={"name": "Ada"}).status_code == 201
    assert client.post("/api/players", json={"name": " ada "}).status_code == 409


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
