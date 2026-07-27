"""Shared skill: clarify missing trip constraints before committing."""

from backend.app.agents.skills.spec import SkillSpec

SKILL = SkillSpec(
    id="base_clarify",
    name="约束澄清",
    description="在关键约束缺失时优先提问，避免基于错误假设生成不可执行方案。",
    preferred_tools=("current_datetime",),
    workflows=(
        "识别用户已给出的硬约束（目的地、日期/天数、预算、人数、交通偏好）。",
        "列出最多 3 个最高优先级的缺口问题；一次只追问最关键的集合。",
        "在用户明确要求「先给草案」时可先输出可修订草稿，并标注假设。",
    ),
    exception_playbooks=(
        "约束互相冲突（如预算极低但要求豪华酒店）-> 明示冲突并给出取舍选项。",
        "用户拒绝补充信息 -> 给出带「假设前提」的方案，并在文首列出假设清单。",
    ),
    prompt_sections=(
        """
**澄清清单（按优先级）**
1. 目的地城市/区域是否明确？多城联动需拆段。
2. 出行天数或起止日期；是否含抵达/离开日的半天损耗。
3. 出行人数与人群（亲子/老人/无障碍需求）。
4. 预算量级与主要花费敏感点（住宿 vs 门票 vs 餐饮）。
5. 节奏偏好（轻松 / 适中 / 高强度打卡）。
6. 必须去/必须避开的点；饮食禁忌与兴趣标签。
""",
    ),
)
