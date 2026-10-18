/* Church events: the time math, the calendar links, and the rule that an
 * unsure time always says so and points at the church's own app. */
import assert from "node:assert/strict";
import test from "node:test";

import {
	buildIcs,
	churchAppFor,
	dedupeEvents,
	formatChurchEventsForModel,
	formatEventWhen,
	googleCalendarUrl,
	icsFileName,
	isLocalDate,
	isLocalTime,
	isUpcoming,
	localDateOf,
	toEventView,
	zonedTimeToUtc,
} from "../src/lib/church-events-rules.ts";

const FMBC = "UCiTssyWZc2PJ25OAZOaN7Ag";
const TZ = "America/Los_Angeles";

function event(overrides = {}) {
	return {
		id: "evt_1",
		studyId: "smn_1",
		videoId: "KXsst9uEVz8",
		title: "Trustees meeting",
		details: null,
		audience: "trustees",
		location: null,
		startsAt: zonedTimeToUtc("2026-10-13", "18:30", TZ),
		endsAt: null,
		allDay: false,
		timeZone: TZ,
		certain: true,
		sourceQuote: "Trustees meet at 6.30.",
		sourceMs: 1_234_567,
		serviceDate: new Date("2026-10-12T12:00:00Z"),
		...overrides,
	};
}

test("a Fresno wall clock time becomes the right instant on both sides of DST", () => {
	// PDT (UTC-7) before the first Sunday of November, PST (UTC-8) after.
	assert.equal(zonedTimeToUtc("2026-10-13", "18:30", TZ).toISOString(), "2026-10-14T01:30:00.000Z");
	assert.equal(zonedTimeToUtc("2026-11-10", "18:30", TZ).toISOString(), "2026-11-11T02:30:00.000Z");
	assert.equal(zonedTimeToUtc("2026-10-19", null, TZ).toISOString(), "2026-10-19T07:00:00.000Z");
	assert.equal(localDateOf(zonedTimeToUtc("2026-10-13", "23:30", TZ), TZ), "2026-10-13");
});

test("dates and times are validated, not trusted", () => {
	assert.equal(isLocalDate("2026-10-13"), true);
	assert.equal(isLocalDate("2026-02-30"), false);
	assert.equal(isLocalDate("tomorrow"), false);
	assert.equal(isLocalTime("18:30"), true);
	assert.equal(isLocalTime("6:30"), true);
	assert.equal(isLocalTime("24:00"), false);
	assert.equal(isLocalTime("6:30 PM"), false);
});

test("the label is in the church's time zone, whatever the server's is", () => {
	assert.equal(formatEventWhen(event()), "Tuesday, October 13 at 6:30 PM");
	assert.equal(
		formatEventWhen(event({ endsAt: zonedTimeToUtc("2026-10-13", "20:00", TZ) })),
		"Tuesday, October 13, 6:30 PM to 8:00 PM"
	);
	assert.equal(
		formatEventWhen(event({ allDay: true, startsAt: zonedTimeToUtc("2026-10-19", null, TZ) })),
		"Monday, October 19"
	);
});

test("an event stays upcoming until it is over, and an all-day one until the day ends", () => {
	const e = event();
	assert.equal(isUpcoming(e, new Date("2026-10-14T02:30:00Z")), true);
	assert.equal(isUpcoming(e, new Date("2026-10-14T03:30:00Z")), false);
	const day = event({ allDay: true, startsAt: zonedTimeToUtc("2026-10-19", null, TZ) });
	assert.equal(isUpcoming(day, new Date("2026-10-20T06:00:00Z")), true); // 11pm Fresno
	assert.equal(isUpcoming(day, new Date("2026-10-20T07:30:00Z")), false);
});

test("the same gathering announced at two services is one event, the newest wins", () => {
	const older = event({ id: "old", serviceDate: new Date("2026-10-05T12:00:00Z"), certain: false });
	const newer = event({ id: "new", title: "The Trustees' Meeting" });
	const other = event({ id: "men", title: "Men's meeting", startsAt: zonedTimeToUtc("2026-10-13", "19:00", TZ) });
	const kept = dedupeEvents([older, other, newer]);
	assert.deepEqual(kept.map((e) => e.id), ["new", "men"]);
});

test("a later announcement with no time keeps the earlier time, as unconfirmed", () => {
	// The real Oct 24 ladies fellowship: four services, only one gave a time.
	const day = zonedTimeToUtc("2026-10-24", null, TZ);
	const announced = (date) => new Date(`${date}T12:00:00Z`);
	const kept = dedupeEvents([
		event({ id: "sep20", title: "Ladies' fellowship lunch", allDay: true, startsAt: day, certain: false, serviceDate: announced("2026-09-20") }),
		event({ id: "sep23", title: "Ladies fellowship", allDay: true, startsAt: day, certain: false, serviceDate: announced("2026-09-23") }),
		event({ id: "oct04", title: "Ladies fellowship", startsAt: zonedTimeToUtc("2026-10-24", "11:00", TZ), certain: false, serviceDate: announced("2026-10-04") }),
		event({ id: "oct18", title: "Ladies fellowship", allDay: true, startsAt: day, certain: false, serviceDate: announced("2026-10-18") }),
	]);
	assert.equal(kept.length, 1);
	assert.equal(kept[0].id, "oct04");
	assert.equal(kept[0].certain, false);
	assert.equal(formatEventWhen(kept[0]), "Saturday, October 24 at 11:00 AM");
	// A certain time restated by nobody is no longer certain either.
	const restated = dedupeEvents([
		event({ id: "a", certain: true, serviceDate: announced("2026-10-04") }),
		event({ id: "b", allDay: true, startsAt: zonedTimeToUtc("2026-10-13", null, TZ), serviceDate: announced("2026-10-11") }),
	]);
	assert.deepEqual(restated.map((e) => [e.id, e.certain]), [["a", false]]);
});

test("Google Calendar gets the UTC span, the place, and the church's time zone", () => {
	const url = new URL(googleCalendarUrl(event(), "First Missionary Baptist Church, 1195 E Shepherd Ave", churchAppFor(FMBC)));
	assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
	assert.equal(url.searchParams.get("action"), "TEMPLATE");
	assert.equal(url.searchParams.get("dates"), "20261014T013000Z/20261014T030000Z");
	assert.equal(url.searchParams.get("ctz"), TZ);
	assert.match(url.searchParams.get("location"), /1195 E Shepherd Ave/);
	assert.match(url.searchParams.get("details"), /Trustees meet at 6\.30/);
	assert.match(url.searchParams.get("details"), /youtube\.com\/watch\?v=KXsst9uEVz8&t=1234s/);
	const allDay = new URL(googleCalendarUrl(event({ allDay: true, startsAt: zonedTimeToUtc("2026-10-19", null, TZ) }), null, null));
	assert.equal(allDay.searchParams.get("dates"), "20261019/20261020");
	assert.equal(allDay.searchParams.has("location"), false);
});

test("an unsure time says so in the calendar entry and names the church app", () => {
	const app = churchAppFor(FMBC);
	const url = new URL(googleCalendarUrl(event({ certain: false }), null, app));
	const details = url.searchParams.get("details");
	assert.match(details, /The time was not clear in the recording\. Check the FMBC Fresno app/);
	assert.match(details, /play\.google\.com\/store\/apps\/details\?id=com\.subsplashconsulting\.s_W98M7N/);
	assert.match(details, /apps\.apple\.com\/us\/app\/fmbc-fresno\/id1567963142/);
	assert.doesNotMatch(new URL(googleCalendarUrl(event(), null, app)).searchParams.get("details"), /not clear/);
});

test("the .ics is valid RFC 5545: CRLF, escaped text, folded lines", () => {
	const ics = buildIcs(
		event({ details: "Bring a dish; all welcome, men and ladies.", certain: false }),
		"First Missionary Baptist Church, Fresno",
		churchAppFor(FMBC),
		new Date("2026-10-12T20:00:00Z")
	);
	assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
	assert.match(ics, /\r\nUID:evt_1@sureword\.app\r\n/);
	assert.match(ics, /\r\nDTSTART:20261014T013000Z\r\n/);
	assert.match(ics, /\r\nDTEND:20261014T030000Z\r\n/);
	assert.match(ics, /\r\nLOCATION:First Missionary Baptist Church\\, Fresno\r\n/);
	assert.match(ics, /Bring a dish\\; all welcome\\, men and ladies\./);
	assert.match(ics, /END:VCALENDAR\r\n$/);
	for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
	assert.doesNotMatch(ics, /[^\r]\n/);
	const allDay = buildIcs(event({ allDay: true, startsAt: zonedTimeToUtc("2026-10-19", null, TZ) }), null, null);
	assert.match(allDay, /DTSTART;VALUE=DATE:20261019\r\nDTEND;VALUE=DATE:20261020/);
	assert.doesNotMatch(allDay, /LOCATION/);
});

test("the view carries everything a client renders, and nothing it must compute", () => {
	const view = toEventView(event(), "First Missionary Baptist Church", churchAppFor(FMBC));
	assert.equal(view.when, "Tuesday, October 13 at 6:30 PM");
	assert.equal(view.icsPath, "/api/church-events/evt_1/ics");
	assert.equal(view.sourceUrl, "https://www.youtube.com/watch?v=KXsst9uEVz8&t=1234s");
	assert.equal(view.location, null);
	assert.equal(view.calendarLocation, "First Missionary Baptist Church");
	assert.equal(view.calendarEndsAt, "2026-10-14T03:00:00.000Z");
	assert.match(view.calendarNotes, /^For: trustees\n\nAnnounced at church: "Trustees meet at 6\.30\."/);
	assert.match(view.googleCalendarUrl, /^https:\/\/calendar\.google\.com\//);
	assert.equal(icsFileName("Trustees & Men's Meeting!"), "trustees-men-s-meeting.ics");
	assert.equal(icsFileName("!!!"), "church-event.ics");
});

test("only ingested churches have an app on file", () => {
	assert.equal(churchAppFor(FMBC)?.name, "FMBC Fresno");
	assert.equal(churchAppFor("UCsomeoneElse"), null);
	assert.equal(churchAppFor(null), null);
});

test("chat is told which times are unconfirmed, and to invent nothing", () => {
	const app = churchAppFor(FMBC);
	const views = [
		toEventView(event(), null, app),
		toEventView(event({ id: "e2", title: "Ladies fellowship", certain: false }), null, app),
	];
	const text = formatChurchEventsForModel(views, app);
	assert.match(text, /- Trustees meeting: Tuesday, October 13 at 6:30 PM \(for trustees\)\. Announced as/);
	assert.match(text, /Ladies fellowship.*TIME NOT CONFIRMED.*FMBC Fresno app/);
	assert.doesNotMatch(text.split("\n")[1], /NOT CONFIRMED/);
	assert.match(text, /never add details that were not announced/);
	assert.match(formatChurchEventsForModel([], app), /never invent an event/);
});
