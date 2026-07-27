"""Local guide skill: common pitfalls and scam patterns."""

from backend.app.agents.skills.spec import SkillSpec

SKILL = SkillSpec(
    id="pitfall_avoid",
    name="避坑经验",
    description="提示常见旅游坑点、支付/交通误区与季节性风险，帮助降低踩雷概率。",
    preferred_tools=("web_search",),
    workflows=(
        "按目的地类型检索常见坑：景区黑车、伪票、强迫消费、迷路高发点。",
        "区分「普遍建议」与「该城特有」；没有把握时说明依据不足。",
        "给出可执行对策（如何识别、如何替代、遇到纠纷找谁）。",
    ),
    exception_playbooks=(
        "安全形势敏感或快速变化 -> 建议查官方旅行提示，不散布未经证实的恐慌。",
        "用户描述已发生纠纷 -> 优先安全与证据保全建议，不冒充法律意见。",
    ),
    prompt_sections=(
        """
**避坑输出格式**
- 风险点（一句话）
- 为何容易中招
- 怎么规避 / 平替
- 严重度：低 / 中 / 高
""",
    ),
)
