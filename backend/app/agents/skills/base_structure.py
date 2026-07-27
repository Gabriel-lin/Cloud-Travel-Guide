"""Shared skill: structured, scannable travel answers."""

from backend.app.agents.skills.spec import SkillSpec

SKILL = SkillSpec(
    id="base_structure",
    name="结构化输出",
    description="用可扫描的层级结构输出，便于用户直接执行或交给审稿智能体。",
    preferred_tools=("draft_day_skeleton", "write_file"),
    workflows=(
        "先用 1-2 句总览，再展开天/时段/地点结构。",
        "每条活动尽量含：地点、建议时段、预留时长、交通备注、花费量级。",
        "文末给出「下一步可调整」要点（不超过 3 条）。",
    ),
    exception_playbooks=(
        "信息不足以填满结构时 -> 用「待确认」占位，勿编造开放时间/票价。",
        "用户只要简答 -> 压缩为短列表，但仍保留天/时段骨架。",
    ),
    prompt_sections=(
        """
**默认输出骨架**
- 总览（目的地 / 天数 / 主题 / 预算档位假设）
- 分日行程：Day N - 主题
  - 上午 / 下午 / 晚上：地点 | 做什么 | 多久 | 交通
- 花费与预订提醒（粗量级）
- 风险与备选（雨天 / 闭馆 / 体力）
""",
    ),
)
