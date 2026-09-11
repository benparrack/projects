"""Formats trading decisions and run summaries into human-readable log output."""

import logging

from trader import RunSummary


def report_run_summary(summary: RunSummary, account: dict, logger: logging.Logger) -> None:
    for line in summary.decisions:
        logger.info(line)

    cash = account.get("cash", "?")
    equity = account.get("equity", "?")
    buying_power = account.get("buying_power", "?")

    logger.info(
        f"Run complete: {summary.symbols_scanned} symbols scanned, "
        f"{summary.buys} buys, {summary.sells} sells, {summary.holds} holds, "
        f"{summary.errors} errors. "
        f"Equity: ${equity} | Cash: ${cash} | Buying power: ${buying_power}"
    )


def format_status(account: dict, positions: list, open_orders: list, enabled: bool) -> str:
    lines = []
    lines.append("=" * 60)
    lines.append("ALPACA PAPER TRADER — STATUS")
    lines.append("=" * 60)
    lines.append(f"Scheduled runs enabled: {enabled}")
    lines.append("-" * 60)
    lines.append(f"Cash:          ${account.get('cash', '?')}")
    lines.append(f"Equity:        ${account.get('equity', '?')}")
    lines.append(f"Buying power:  ${account.get('buying_power', '?')}")
    lines.append(f"Trading blocked: {account.get('trading_blocked', '?')}")
    lines.append(f"Account blocked: {account.get('account_blocked', '?')}")
    lines.append("-" * 60)
    lines.append(f"Open positions ({len(positions)}):")
    if not positions:
        lines.append("  (none)")
    for p in positions:
        lines.append(
            f"  {p.get('symbol'):<8} qty={p.get('qty')} "
            f"avg_entry=${p.get('avg_entry_price')} unrealized_pl=${p.get('unrealized_pl')}"
        )
    lines.append("-" * 60)
    lines.append(f"Open orders ({len(open_orders)}):")
    if not open_orders:
        lines.append("  (none)")
    for o in open_orders:
        lines.append(
            f"  {o.get('symbol'):<8} {o.get('side'):<4} status={o.get('status')} "
            f"qty={o.get('qty')} notional={o.get('notional')}"
        )
    lines.append("=" * 60)
    return "\n".join(lines)
