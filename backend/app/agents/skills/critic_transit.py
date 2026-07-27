"""Critic skill: transit feasibility."""

from backend.app.agents.skills.spec import SkillSpec

SKILL = SkillSpec(
    id="critic_transit",
    name="交通衔接审稿",
    description="检查点与点之间交通是否合理，衔接是否过紧，是否存在不必要的折返。",
    preferred_tools=("estimate_transit_gap", "geocode_place"),
    workflows=(
        "按日梳理活动顺序，标出跨区跳转。",
        "对可疑长距离衔接做粗时估算，判断是否挤占游览时间。",
        "建议调整顺序（顺路重排）或改为「专日交通 + 目的地区深逛」。",
    ),
    exception_playbooks=(
        "缺少具体地址/坐标 -> 用片区级判断并声明精度限制。",
        "依赖准时轮渡/末班车 -> 要求用户预留缓冲并给 Plan B。",
    ),
    prompt_sections=(
        """
**交通审稿关注点**
- 同日东西跨城/跨山是否现实。
- 退房/赶飞机日是否仍排满市区景点。
- 行李日（入住前/退房后）动线是否友好。
""",
    ),
)
