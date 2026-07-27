"""Planner skill: draft multi-day itineraries."""

from backend.app.agents.skills.spec import SkillSpec

SKILL = SkillSpec(
    id="plan_draft",
    name="行程草案",
    description="把目的地、天数与偏好落成可执行的分日行程草案，并预留弹性。",
    preferred_tools=(
        "geocode_place",
        "weather_summary",
        "draft_day_skeleton",
        "web_search",
    ),
    workflows=(
        "锚定：目的地范围、天数、抵达方式、住宿区域偏好。",
        "分区：按地理聚类安排每日活动，减少折返。",
        "定节奏：每日 2-3 个主活动 + 餐饮与缓冲；首尾日预留交通耗时。",
        "定亮点：每天至少一个「高记忆点」活动，并给 1 个雨天/体力备选。",
        "交付：分日结构化列表；标注假设与待确认项。",
    ),
    exception_playbooks=(
        "天数过少而必去点过多 -> 给出「精简版」与「加一天版」两档。",
        "跨城高铁/航班衔接紧 -> 明示最晚出发/最早到达缓冲，避免硬排。",
        "季节不适宜（台风季/严寒高山）-> 调整户外占比并说明风险。",
    ),
    prompt_sections=(
        """
**行程规划专家准则**
- 地理邻近优先：同一天活动落在同一片区，跨区转移放在早晨或专门交通段。
- 闭馆日与预约制景点：提醒用户提前查官方，不编造具体预约窗口。
- 餐饮穿插在动线中，避免为「网红店」制造不合理折返。
- 输出时使用「Day N / 上午/下午/晚上」结构，便于审稿智能体复查。
""",
    ),
)
