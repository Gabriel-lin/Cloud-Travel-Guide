from fastapi import APIRouter

from backend.app.api.v1.auth import router as auth_router
from backend.app.api.v1.plan import router as plan_router
from backend.app.api.v1.plan_threads import router as plan_threads_router
from backend.app.api.v1.plans import router as plans_router
from backend.app.api.v1.system import router as system_router

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(system_router)
api_v1_router.include_router(auth_router)
api_v1_router.include_router(plan_router)
api_v1_router.include_router(plan_threads_router)
api_v1_router.include_router(plans_router)
