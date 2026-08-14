# Copyright (c) 2026, FOSS United and contributors
# See license.txt
"""
Tests for quiz proctoring: violation event persistence, permission gates, and
the is_open_ended_submission helper.

Organised into four layers:
  1. TestViolationEventNormalization  — pure unit tests, frappe.db.bulk_insert patched
  2. TestSaveViolationEventsDB        — integration: events actually land in DB
  3. TestSubmitQuizWithViolations     — integration: submit_quiz + violations end-to-end
  4. TestGetQuizViolationLogs         — permission checks + returned data shape
  5. TestIsOpenEndedSubmission        — boolean helper for frontend editable-marks gate
"""

import json
import unittest
from unittest.mock import patch

import frappe

from lms.lms.doctype.lms_quiz.lms_quiz import (
	_save_violation_events,
	get_quiz_violation_logs,
	is_open_ended_submission,
	submit_quiz,
)

# ---------------------------------------------------------------------------
# Shared fixture builders
# ---------------------------------------------------------------------------


def _make_question():
	q = frappe.new_doc("LMS Question")
	q.update(
		{
			"question": f"Proctoring test question {frappe.generate_hash(length=6)}?",
			"type": "Choices",
			"option_1": "Correct",
			"is_correct_1": 1,
			"option_2": "Wrong",
			"is_correct_2": 0,
		}
	)
	q.save(ignore_permissions=True)
	return q


def _make_quiz(question, title=None):
	title = title or f"Proctoring Quiz {frappe.generate_hash(length=6)}"
	quiz = frappe.new_doc("LMS Quiz")
	quiz.update(
		{
			"title": title,
			"passing_percentage": 50,
			"enable_proctoring": 1,
			"max_violations": 3,
		}
	)
	quiz.append("questions", {"question": question.name, "marks": 5})
	quiz.save(ignore_permissions=True)
	return quiz


def _make_submission(quiz_name, member="Administrator"):
	sub = frappe.new_doc("LMS Quiz Submission")
	sub.update(
		{
			"quiz": quiz_name,
			"member": member,
			"score": 0,
			"score_out_of": 5,
			"percentage": 0,
			"passing_percentage": 50,
		}
	)
	sub.save(ignore_permissions=True)
	return sub


def _get_logs(submission_name):
	return frappe.get_all(
		"LMS Quiz Violation Log",
		filters={"quiz_submission": submission_name},
		fields=["event_type", "severity", "timestamp"],
		order_by="timestamp asc",
		ignore_permissions=True,
	)


# ---------------------------------------------------------------------------
# 1. Pure unit tests — frappe.db.bulk_insert is patched, no DB writes
# ---------------------------------------------------------------------------


class TestViolationEventNormalization(unittest.TestCase):
	"""_save_violation_events normalises timestamps, event types, and severities
	before building the bulk-insert rows. All assertions run against the captured
	tuple list; the real DB is never touched."""

	def _capture(self, events):
		"""Run _save_violation_events and return the rows that would be inserted."""
		captured = []
		with patch("frappe.db.bulk_insert", side_effect=lambda dt, fields, values: captured.extend(values)):
			_save_violation_events("dummy-sub", events)
		return captured

	# Fields order in each row tuple:
	# [0] name  [1] creation  [2] modified  [3] modified_by  [4] owner
	# [5] docstatus  [6] idx  [7] quiz_submission  [8] event_type
	# [9] severity  [10] timestamp

	def test_iso_timestamp_with_T_and_Z_normalised_to_mariadb(self):
		rows = self._capture(
			[{"eventType": "tab_switch", "severity": "violation", "timestamp": "2026-07-31T08:38:00.000Z"}]
		)
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0][10], "2026-07-31 08:38:00")

	def test_iso_timestamp_without_milliseconds_normalised(self):
		rows = self._capture(
			[{"eventType": "tab_switch", "severity": "violation", "timestamp": "2026-07-31T08:38:00Z"}]
		)
		self.assertEqual(rows[0][10], "2026-07-31 08:38:00")

	def test_missing_timestamp_falls_back_to_server_now(self):
		rows = self._capture([{"eventType": "tab_switch", "severity": "violation"}])
		self.assertEqual(len(rows), 1)
		# Server-generated timestamp must not contain the ISO separators
		self.assertNotIn("T", rows[0][10])

	def test_camel_case_eventType_key_is_accepted(self):
		rows = self._capture(
			[{"eventType": "no_face", "severity": "violation", "timestamp": "2026-01-01T00:00:00Z"}]
		)
		self.assertEqual(rows[0][8], "no_face")

	def test_snake_case_event_type_key_is_accepted(self):
		rows = self._capture(
			[{"event_type": "focus_loss", "severity": "violation", "timestamp": "2026-01-01T00:00:00Z"}]
		)
		self.assertEqual(rows[0][8], "focus_loss")

	def test_camel_case_takes_precedence_over_snake_case(self):
		# If both keys exist, camelCase wins (matches JS payload shape)
		rows = self._capture(
			[{"eventType": "tab_switch", "event_type": "no_face", "timestamp": "2026-01-01T00:00:00Z"}]
		)
		self.assertEqual(rows[0][8], "tab_switch")

	def test_unknown_event_type_is_silently_dropped(self):
		rows = self._capture(
			[
				{"eventType": "hacked_event", "severity": "violation"},
				{"eventType": "tab_switch", "severity": "violation", "timestamp": "2026-01-01T00:00:00Z"},
			]
		)
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0][8], "tab_switch")

	def test_invalid_severity_coerced_to_violation(self):
		rows = self._capture(
			[{"eventType": "tab_switch", "severity": "critical", "timestamp": "2026-01-01T00:00:00Z"}]
		)
		self.assertEqual(rows[0][9], "violation")

	def test_warning_severity_preserved(self):
		rows = self._capture(
			[{"eventType": "no_face", "severity": "warning", "timestamp": "2026-01-01T00:00:00Z"}]
		)
		self.assertEqual(rows[0][9], "warning")

	def test_empty_event_list_never_calls_bulk_insert(self):
		with patch("frappe.db.bulk_insert") as mock_insert:
			_save_violation_events("dummy-sub", [])
		mock_insert.assert_not_called()

	def test_all_five_valid_event_types_are_accepted(self):
		valid_types = ["tab_switch", "no_face", "multiple_faces", "focus_loss", "camera_disconnect"]
		events = [
			{"eventType": t, "severity": "violation", "timestamp": "2026-01-01T00:00:00Z"}
			for t in valid_types
		]
		rows = self._capture(events)
		self.assertEqual(len(rows), len(valid_types))
		saved_types = [r[8] for r in rows]
		self.assertCountEqual(saved_types, valid_types)

	def test_mixed_valid_and_invalid_types_keeps_only_valid(self):
		rows = self._capture(
			[
				{"eventType": "tab_switch", "timestamp": "2026-01-01T00:00:00Z"},
				{"eventType": "screen_capture", "timestamp": "2026-01-01T00:01:00Z"},  # invalid
				{"eventType": "multiple_faces", "timestamp": "2026-01-01T00:02:00Z"},
			]
		)
		self.assertEqual(len(rows), 2)


# ---------------------------------------------------------------------------
# 2. Integration — events actually written to the database
# ---------------------------------------------------------------------------


class TestSaveViolationEventsDB(unittest.TestCase):
	"""_save_violation_events with a real DB submission."""

	@classmethod
	def setUpClass(cls):
		cls.question = _make_question()
		cls.quiz = _make_quiz(cls.question)
		cls.submission = _make_submission(cls.quiz.name)

	@classmethod
	def tearDownClass(cls):
		frappe.db.delete("LMS Quiz Violation Log", {"quiz_submission": cls.submission.name})
		frappe.db.delete("LMS Quiz Submission", cls.submission.name)
		frappe.db.delete("LMS Quiz", cls.quiz.name)
		frappe.db.delete("LMS Question", cls.question.name)

	def setUp(self):
		frappe.db.delete("LMS Quiz Violation Log", {"quiz_submission": self.submission.name})

	def test_valid_events_land_in_db(self):
		_save_violation_events(
			self.submission.name,
			[
				{"eventType": "tab_switch", "severity": "violation", "timestamp": "2026-07-01T10:00:00Z"},
				{"eventType": "no_face", "severity": "warning", "timestamp": "2026-07-01T10:01:00Z"},
			],
		)
		logs = _get_logs(self.submission.name)
		self.assertEqual(len(logs), 2)
		self.assertEqual(logs[0].event_type, "tab_switch")
		self.assertEqual(logs[0].severity, "violation")
		self.assertEqual(logs[1].event_type, "no_face")
		self.assertEqual(logs[1].severity, "warning")

	def test_timestamp_stored_without_iso_separators(self):
		_save_violation_events(
			self.submission.name,
			[{"eventType": "focus_loss", "severity": "violation", "timestamp": "2026-07-15T14:30:45.123Z"}],
		)
		logs = _get_logs(self.submission.name)
		ts_str = str(logs[0].timestamp)
		self.assertNotIn("T", ts_str)
		self.assertNotIn("Z", ts_str)
		self.assertIn("14:30:45", ts_str)

	def test_unknown_events_not_stored(self):
		_save_violation_events(
			self.submission.name,
			[
				{"eventType": "totally_fake", "severity": "violation"},
				{
					"eventType": "camera_disconnect",
					"severity": "violation",
					"timestamp": "2026-07-01T10:00:00Z",
				},
			],
		)
		logs = _get_logs(self.submission.name)
		self.assertEqual(len(logs), 1)
		self.assertEqual(logs[0].event_type, "camera_disconnect")

	def test_multiple_calls_append_not_replace(self):
		_save_violation_events(
			self.submission.name,
			[{"eventType": "tab_switch", "severity": "violation", "timestamp": "2026-07-01T10:00:00Z"}],
		)
		_save_violation_events(
			self.submission.name,
			[{"eventType": "no_face", "severity": "violation", "timestamp": "2026-07-01T10:01:00Z"}],
		)
		logs = _get_logs(self.submission.name)
		self.assertEqual(len(logs), 2)


# ---------------------------------------------------------------------------
# 3. End-to-end: submit_quiz persists violation_count and violation_events
# ---------------------------------------------------------------------------


class TestSubmitQuizWithViolations(unittest.TestCase):
	"""submit_quiz — violation_count, submission_reason, and violation_events are
	all persisted correctly through the full submission path."""

	@classmethod
	def setUpClass(cls):
		cls.question = _make_question()
		cls.quiz = _make_quiz(cls.question)
		cls.original_user = frappe.session.user
		frappe.session.user = "Administrator"

	@classmethod
	def tearDownClass(cls):
		frappe.session.user = cls.original_user
		frappe.db.delete("LMS Quiz Violation Log")
		frappe.db.delete("LMS Quiz Submission", {"quiz": cls.quiz.name})
		frappe.db.delete("LMS Quiz", cls.quiz.name)
		frappe.db.delete("LMS Question", cls.question.name)

	def _results(self):
		return json.dumps([{"question_name": self.question.name, "answer": ["Correct"]}])

	def test_violation_count_saved_on_submission(self):
		result = submit_quiz(self.quiz.name, results=self._results(), violation_count=2)
		count = frappe.db.get_value("LMS Quiz Submission", result["submission"], "violation_count")
		self.assertEqual(count, 2)

	def test_submission_reason_saved(self):
		result = submit_quiz(self.quiz.name, results=self._results(), submission_reason="max_violations")
		reason = frappe.db.get_value("LMS Quiz Submission", result["submission"], "submission_reason")
		self.assertEqual(reason, "max_violations")

	def test_violation_events_persisted_when_provided(self):
		events = json.dumps(
			[
				{"eventType": "tab_switch", "severity": "violation", "timestamp": "2026-07-01T10:00:00Z"},
				{"eventType": "no_face", "severity": "warning", "timestamp": "2026-07-01T10:01:00Z"},
			]
		)
		result = submit_quiz(
			self.quiz.name,
			results=self._results(),
			violation_count=1,
			violation_events=events,
		)
		logs = _get_logs(result["submission"])
		self.assertEqual(len(logs), 2)
		saved_types = {log.event_type for log in logs}
		self.assertIn("tab_switch", saved_types)
		self.assertIn("no_face", saved_types)

	def test_invalid_violation_events_json_raises_validation_error(self):
		# _parse_json_arg rejects malformed JSON with a clean ValidationError rather
		# than a raw 500. The Vue component retries without violation_events on this path.
		with self.assertRaises(frappe.ValidationError):
			submit_quiz(
				self.quiz.name,
				results=self._results(),
				violation_events="not-valid-json",
			)

	def test_submit_without_violation_events_succeeds(self):
		result = submit_quiz(self.quiz.name, results=self._results())
		self.assertIn("submission", result)
		self.assertIn("score", result)

	def test_zero_violation_count_is_stored(self):
		result = submit_quiz(self.quiz.name, results=self._results(), violation_count=0)
		count = frappe.db.get_value("LMS Quiz Submission", result["submission"], "violation_count")
		self.assertEqual(count, 0)

	def test_invalid_event_types_in_payload_are_dropped_not_stored(self):
		events = json.dumps(
			[
				{"eventType": "illegal_action", "severity": "violation"},
				{"eventType": "tab_switch", "severity": "violation", "timestamp": "2026-07-01T10:00:00Z"},
			]
		)
		result = submit_quiz(
			self.quiz.name, results=self._results(), violation_count=1, violation_events=events
		)
		logs = _get_logs(result["submission"])
		self.assertEqual(len(logs), 1)
		self.assertEqual(logs[0].event_type, "tab_switch")


# ---------------------------------------------------------------------------
# 4. get_quiz_violation_logs — permission gates and data accuracy
# ---------------------------------------------------------------------------


class TestGetQuizViolationLogs(unittest.TestCase):
	"""get_quiz_violation_logs enforces that only the submission owner (or a
	privileged user) can read violation logs."""

	@classmethod
	def setUpClass(cls):
		hash_ = frappe.generate_hash(length=6)

		cls.student = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"proc-student-{hash_}@test.com",
				"first_name": "Proctor",
				"last_name": "Student",
				"send_welcome_email": 0,
				"roles": [{"role": "LMS Student"}],
			}
		).insert(ignore_permissions=True)

		cls.outsider = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"proc-outsider-{hash_}@test.com",
				"first_name": "Proctor",
				"last_name": "Outsider",
				"send_welcome_email": 0,
				"roles": [{"role": "LMS Student"}],
			}
		).insert(ignore_permissions=True)

		cls.question = _make_question()
		cls.quiz = _make_quiz(cls.question)
		cls.submission = _make_submission(cls.quiz.name, member=cls.student.name)

		_save_violation_events(
			cls.submission.name,
			[
				{"eventType": "tab_switch", "severity": "violation", "timestamp": "2026-07-01T09:00:00Z"},
				{"eventType": "no_face", "severity": "warning", "timestamp": "2026-07-01T09:01:00Z"},
			],
		)

	@classmethod
	def tearDownClass(cls):
		frappe.db.delete("LMS Quiz Violation Log", {"quiz_submission": cls.submission.name})
		frappe.db.delete("LMS Quiz Submission", cls.submission.name)
		frappe.db.delete("LMS Quiz", cls.quiz.name)
		frappe.db.delete("LMS Question", cls.question.name)
		frappe.delete_doc("User", cls.student.name, force=True, ignore_permissions=True)
		frappe.delete_doc("User", cls.outsider.name, force=True, ignore_permissions=True)

	def _call(self, user):
		original = frappe.session.user
		frappe.session.user = user
		try:
			return get_quiz_violation_logs(self.submission.name)
		finally:
			frappe.session.user = original

	def test_submission_owner_can_read_logs(self):
		logs = self._call(self.student.name)
		self.assertEqual(len(logs), 2)

	def test_system_manager_can_read_logs(self):
		logs = self._call("Administrator")
		self.assertEqual(len(logs), 2)

	def test_unrelated_student_is_rejected(self):
		with self.assertRaises(frappe.PermissionError):
			self._call(self.outsider.name)

	def test_nonexistent_submission_raises_validation_error(self):
		original = frappe.session.user
		frappe.session.user = "Administrator"
		try:
			with self.assertRaises(frappe.ValidationError):
				get_quiz_violation_logs("nonexistent-submission-xyz")
		finally:
			frappe.session.user = original

	def test_logs_returned_in_ascending_timestamp_order(self):
		logs = self._call("Administrator")
		self.assertEqual(logs[0].event_type, "tab_switch")
		self.assertEqual(logs[1].event_type, "no_face")

	def test_returned_fields_include_event_type_severity_timestamp(self):
		logs = self._call("Administrator")
		first = logs[0]
		self.assertIn("event_type", first)
		self.assertIn("severity", first)
		self.assertIn("timestamp", first)

	def test_severities_are_stored_correctly(self):
		logs = self._call("Administrator")
		severity_map = {log.event_type: log.severity for log in logs}
		self.assertEqual(severity_map["tab_switch"], "violation")
		self.assertEqual(severity_map["no_face"], "warning")


# ---------------------------------------------------------------------------
# 5. is_open_ended_submission
# ---------------------------------------------------------------------------


class TestIsOpenEndedSubmission(unittest.TestCase):
	"""is_open_ended_submission returns True/False based on the linked quiz's
	question type, enabling the frontend to decide whether marks are editable."""

	@classmethod
	def setUpClass(cls):
		cls.question = _make_question()  # Choices type
		cls.quiz = _make_quiz(cls.question)
		cls.submission = _make_submission(cls.quiz.name)

	@classmethod
	def tearDownClass(cls):
		frappe.db.delete("LMS Quiz Submission", cls.submission.name)
		frappe.db.delete("LMS Quiz", cls.quiz.name)
		frappe.db.delete("LMS Question", cls.question.name)

	def test_choice_quiz_returns_false(self):
		self.assertFalse(is_open_ended_submission(self.submission.name))

	def test_nonexistent_submission_returns_false(self):
		self.assertFalse(is_open_ended_submission("does-not-exist-xyz"))

	def test_returns_bool_not_truthy(self):
		result = is_open_ended_submission(self.submission.name)
		self.assertIsInstance(result, bool)
