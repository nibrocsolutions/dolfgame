from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.config import settings
from app.database import Base, engine

STATIC_DIR = Path(__file__).resolve().parent / "static"


class FreshStaticFiles(StaticFiles):
    """Ask the phone to recheck scripts and styles after a rebuild."""

    def file_response(self, full_path, stat_result, scope, status_code=200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        response.headers["Cache-Control"] = "no-cache"
        return response


def stamped_html(name: str, assets: tuple[str, ...]) -> str:
    html = (STATIC_DIR / name).read_text(encoding="utf-8")
    for asset in assets:
        stamp = int((STATIC_DIR / asset).stat().st_mtime)
        html = html.replace(f"/static/{asset}", f"/static/{asset}?v={stamp}", 1)
    return html


def index_html() -> str:
    return stamped_html("index.html", ("css/app.css", "js/app.js"))


def admin_html() -> str:
    return stamped_html("admin.html", ("css/app.css", "js/admin.js"))


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.include_router(router)
app.mount("/static", FreshStaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> HTMLResponse:
    return HTMLResponse(index_html(), headers={"Cache-Control": "no-cache"})


@app.get("/admin")
def admin() -> HTMLResponse:
    return HTMLResponse(admin_html(), headers={"Cache-Control": "no-cache"})
