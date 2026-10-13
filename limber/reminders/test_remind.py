# Run: python3 test_remind.py
from datetime import date, datetime
from remind import due, message, streak

T = ["19:30", "22:00"]
at = lambda hm: datetime(2026, 10, 13, *map(int, hm.split(":")))
assert due(at("18:00"), T, [], False) is None
assert due(at("19:31"), T, [], False) == "19:30"
assert due(at("19:45"), T, ["19:30"], False) is None
assert due(at("22:10"), T, ["19:30"], False) == "22:00"
assert due(at("22:10"), T, [], False) == "22:00"  # computer was off at 19:30: one ping, not two
assert due(at("21:00"), T, [], True) is None  # already stretched
assert streak({"2026-10-12", "2026-10-11", "2026-10-09"}, date(2026, 10, 13)) == 2
assert "streak ends" in message("22:00", T, 5)[1] and message("19:30", T, 0)[0] == "Time to stretch"
from remind import recap
sun = datetime(2026, 10, 18, 21, 0)  # a Sunday
wk = {"2026-10-12", "2026-10-13", "2026-10-15", "2026-10-17", "2026-10-18", "2026-10-11"}
r = recap(sun, wk, "20:45", None)
assert r[0] == "2026-W42" and r[1] == "This week: 5 of 7 days" and r[2].startswith("2-day streak"), r
assert recap(sun, wk, "20:45", "2026-W42") is None  # once a week
assert recap(datetime(2026, 10, 18, 20, 0), wk, "20:45", None) is None  # too early
assert recap(datetime(2026, 10, 17, 21, 0), wk, "20:45", None) is None  # not Sunday
assert recap(sun, wk, "", None) is None  # disabled
print("ok")
