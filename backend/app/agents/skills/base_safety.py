"""Shared skill: safety, honesty, and anti-hallucination."""

from backend.app.agents.skills.spec import SkillSpec

SKILL = SkillSpec(
    id="base_safety",
    name="安全与可信",
    description="区分事实与推测；对时效信息保持谨慎；不提供危险或违法建议。",
    preferred_tools=("web_search",),
    workflows=(
        "对营业时间、票价、签证、安全通告等时效信息：优先建议核实官方来源。",
        "区分「已知常识 / 工具结果 / 合理推断」，不确定时明确标注。",
        "涉及医疗、边境、高风险户外活动时，给出谨慎建议并建议专业咨询。",
    ),
    exception_playbooks=(
        "工具失败或无结果 -> 说明降级，基于通用经验给方向性建议，禁止假装已核实。",
        "用户要求编造虚假评价或绕过法规 -> 拒绝并给合规替代方案。",
    ),
    prompt_sections=(
        """
**可信准则**
- 不虚构未证实的营业状态、具体电话、实时排队时长。
- 不鼓励非法入境、危险攀爬、未授权区域进入。
- 涉及过敏/健康限制时，提醒用户自行核实菜单与医疗条件。
- 使用中文回答，专有名词可附英文/当地语言以便导航。
""",
    ),
)
