"""Planner skill: balance budget across lodging, food, tickets."""

from backend.app.agents.skills.spec import SkillSpec

SKILL = SkillSpec(
    id="budget_balance",
    name="预算平衡",
    description="在给定预算档位下分配住宿、餐饮、门票与体验，并给出可砍/可加选项。",
    preferred_tools=("estimate_budget", "web_search"),
    workflows=(
        "先定档位（经济 / 适中 / 舒适 / 奢华）或用用户给出的总预算反推每日可花。",
        "按「住宿 / 餐饮 / 门票体验 / 本地交通」粗分，再按目的地成本调整。",
        "每个高花费项提供平替选项；标明哪些是一次性大额（演出/门票）。",
    ),
    exception_playbooks=(
        "总预算明显不足以覆盖住宿底线 -> 建议缩短天数、换住宿区或降档体验。",
        "用户只给模糊「便宜点」-> 给三档对照，让其点选。",
    ),
    prompt_sections=(
        """
**预算表达规范**
- 使用大致区间（如「人均餐饮 80-120」），标注币种假设（默认 CNY，除非用户指定）。
- 区分「必须花费」与「可选加购」。
- 不要伪造实时房价；引导用户用 OTA 核对。
""",
    ),
)
