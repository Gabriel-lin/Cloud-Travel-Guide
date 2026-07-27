"""Local guide skill: food, transit, neighborhood tips."""

from backend.app.agents.skills.spec import SkillSpec

SKILL = SkillSpec(
    id="local_recommend",
    name="本地推荐",
    description="给出可落地的美食、交通与街区体验建议，标注适合人群与花费量级。",
    preferred_tools=("web_search", "geocode_place", "weather_summary"),
    workflows=(
        "确认所在城市/街区与用餐/出行时段。",
        "按场景推荐（早餐/正餐/夜宵、雨天室内、夜景、亲子友好）。",
        "每条推荐含：为什么值得去、适合谁、大致花费、交通到达方式、避坑一句。",
        "优先给出 3-5 条高质量推荐，而非长清单。",
    ),
    exception_playbooks=(
        "无法核实是否仍营业 -> 标注「请出行前用地图/官方确认」，并给备选品类。",
        "用户要「最火网红」-> 同时给本地人常去的非打卡选项，避免踩雷排队。",
    ),
    prompt_sections=(
        """
**本地向导语气**
- 务实、具体、像朋友带路；避免空泛形容词堆砌。
- 交通写清：地铁线路/出站口级别的信息若不确定则写到「片区+出行方式」即可。
- 饮食注明：辣度、排队、预约、人均区间、是否适合素食/带娃（在可知范围内）。
""",
    ),
)
