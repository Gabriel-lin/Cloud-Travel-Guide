"""Critic skill: pace and density review."""

from backend.app.agents.skills.spec import SkillSpec

SKILL = SkillSpec(
    id="critic_pace",
    name="节奏审稿",
    description="检查每日景点密度、停留时长与休息缓冲是否合理。",
    preferred_tools=("score_pace", "validate_itinerary"),
    workflows=(
        "统计每日主活动数量与跨区次数。",
        "识别「上午过满 / 晚上过晚 / 无午休」模式。",
        "给出可落地的删减、合并或换日建议，而不是只说「太满了」。",
    ),
    exception_playbooks=(
        "用户明确要「特种兵打卡」-> 接受高强度但强制标注疲劳与误车风险。",
        "行程文本不完整 -> 先列出无法审的缺口，再对已有部分给意见。",
    ),
    prompt_sections=(
        """
**节奏审稿标准**
- 休闲游：每日主活动 <= 3，保留弹性。
- 标准游：2-4 个主活动，跨区 <= 1 次为佳。
- 任何一天连续户外超过 8 小时需提示体力风险。
""",
    ),
)
