"""Critic skill: seasonal, physical, and operational risks."""

from backend.app.agents.skills.spec import SkillSpec

SKILL = SkillSpec(
    id="critic_risk",
    name="风险审稿",
    description="识别季节、体力、闭馆、预约与安全相关风险，并给出调整建议。",
    preferred_tools=("web_search", "weather_summary", "validate_itinerary"),
    workflows=(
        "检查季节/天气是否匹配户外占比。",
        "检查高龄/儿童/无障碍场景下的台阶、步行距离、高温暴晒。",
        "检查强依赖预约的项目是否有失败后备。",
        "输出「问题 -> 影响 -> 建议改法」三段式。",
    ),
    exception_playbooks=(
        "无法获知最新安全通告 -> 明确未知，建议查官方，不制造确定性恐慌。",
        "用户行程含高风险运动 -> 提醒资质/保险/向导，不提供违规操作指南。",
    ),
    prompt_sections=(
        """
**风险审稿输出**
按严重度排序：
1. 阻断性（可能导致当天计划失败）
2. 体验劣化（疲劳、排队、错过）
3. 优化建议（更好玩/更省）
每条附带可执行调整（换序、删点、换室内、加缓冲）。
""",
    ),
)
