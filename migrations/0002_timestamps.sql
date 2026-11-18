-- When a workout started and finished, when each set was logged, and when each exercise was added to a workout.
-- Times are ISO-8601 UTC strings taken from the device that logged them (so offline logging keeps real times).
-- Rows from before this migration have no times.
ALTER TABLE workouts ADD COLUMN started_at TEXT;
ALTER TABLE workouts ADD COLUMN finished_at TEXT;
ALTER TABLE sets ADD COLUMN logged_at TEXT;
CREATE TABLE IF NOT EXISTS workout_exercises (
  workout_id INTEGER NOT NULL,
  exercise_id INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (workout_id, exercise_id)
);
