"""Safe arithmetic calculator for budget / day-count math."""

from __future__ import annotations

import ast
import operator
from typing import Any, cast

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json

_BIN_OPS: dict[type[ast.operator], Any] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPS: dict[type[ast.unaryop], Any] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}


class CalculatorInput(BaseModel):
    expression: str = Field(
        description="Arithmetic expression using + - * / // % ** and parentheses, e.g. '(550*3*2)+800'"
    )


def _eval_node(node: ast.AST) -> float | int:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
        return cast(
            float | int,
            _UNARY_OPS[type(node.op)](_eval_node(node.operand)),
        )
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
        left = _eval_node(node.left)
        right = _eval_node(node.right)
        return cast(float | int, _BIN_OPS[type(node.op)](left, right))
    raise ValueError("Only numeric arithmetic is allowed")


def _calculator(expression: str) -> str:
    try:
        tree = ast.parse(expression.strip(), mode="eval")
        value = _eval_node(tree)
    except Exception as exc:
        return dumps_json({"ok": False, "error": str(exc), "expression": expression})
    return dumps_json({"ok": True, "expression": expression, "result": value})


def build_calculator_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="calculator",
        description=(
            "Evaluate a safe arithmetic expression (no variables/functions). "
            "Useful for budget totals, per-person splits, and day counts."
        ),
        func=_calculator,
        args_schema=CalculatorInput,
    )
