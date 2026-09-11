"""Orchestration: loop leagues, fetch odds, run arbitrage analysis."""

import logging
from datetime import datetime, timezone

from arbitrage import analyze_event
from odds_client import OddsAPIClient, OddsAPIError


def _is_pre_match(event: dict) -> bool:
    """True if the event's commence_time is still in the future.

    Odds on events already underway reflect live in-play state (score,
    momentum, etc.), not independent cross-book pricing of the same
    pre-match event — a "gap" there isn't a real arbitrage opportunity,
    just books reacting to the game at different speeds. Skip those.
    """
    commence_time = event.get("commence_time")
    if not isinstance(commence_time, str):
        return True
    try:
        dt = datetime.fromisoformat(commence_time.replace("Z", "+00:00"))
    except ValueError:
        return True
    return dt > datetime.now(timezone.utc)


def scan_league(
    client: OddsAPIClient,
    sport_key: str,
    sport_title: str,
    regions: str,
    bankroll: float,
    logger: logging.Logger,
    commissions: dict = None,
):
    opportunities = []
    try:
        events, quota_info = client.get_odds(sport_key, regions)
    except OddsAPIError as e:
        logger.error(f"[{sport_key}] Skipping league — {e}")
        return opportunities, None, 0

    pre_match_events = [e for e in events if _is_pre_match(e)]
    skipped_live = len(events) - len(pre_match_events)
    if skipped_live:
        logger.debug(f"[{sport_key}] Skipped {skipped_live} live/in-play event(s).")

    for event in pre_match_events:
        opp = analyze_event(event, sport_key, sport_title, bankroll, commissions=commissions)
        if opp is not None:
            opportunities.append(opp)

    logger.debug(f"[{sport_key}] {len(pre_match_events)} pre-match events analyzed.")
    return opportunities, quota_info, len(pre_match_events)


def run_scan(
    client: OddsAPIClient,
    leagues: list,
    league_titles: dict,
    regions: str,
    bankroll: float,
    logger: logging.Logger,
    commissions: dict = None,
):
    all_opportunities = []
    events_analyzed = 0
    last_quota_info = None

    for sport_key in leagues:
        title = league_titles.get(sport_key, sport_key)
        opportunities, quota_info, event_count = scan_league(
            client, sport_key, title, regions, bankroll, logger, commissions=commissions
        )
        all_opportunities.extend(opportunities)
        events_analyzed += event_count
        if quota_info is not None:
            last_quota_info = quota_info

    return all_opportunities, last_quota_info, events_analyzed
