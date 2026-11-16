CREATE TABLE exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  muscle_group TEXT NOT NULL DEFAULT 'Other',
  equipment TEXT NOT NULL DEFAULT 'Other',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Workout',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_workouts_date ON workouts(date);

CREATE TABLE sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  weight REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  rpe REAL,
  is_warmup INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sets_workout ON sets(workout_id);
CREATE INDEX idx_sets_exercise ON sets(exercise_id);

CREATE TABLE bodyweight (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  weight REAL NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('unit', 'kg');

INSERT INTO exercises (name, muscle_group, equipment) VALUES
 ('Bench Press', 'Chest', 'Barbell'),
 ('Incline Bench Press', 'Chest', 'Barbell'),
 ('Dumbbell Bench Press', 'Chest', 'Dumbbell'),
 ('Incline Dumbbell Press', 'Chest', 'Dumbbell'),
 ('Chest Fly', 'Chest', 'Cable'),
 ('Push-Up', 'Chest', 'Bodyweight'),
 ('Dip', 'Chest', 'Bodyweight'),
 ('Deadlift', 'Back', 'Barbell'),
 ('Barbell Row', 'Back', 'Barbell'),
 ('Dumbbell Row', 'Back', 'Dumbbell'),
 ('Pull-Up', 'Back', 'Bodyweight'),
 ('Chin-Up', 'Back', 'Bodyweight'),
 ('Lat Pulldown', 'Back', 'Cable'),
 ('Seated Cable Row', 'Back', 'Cable'),
 ('Face Pull', 'Shoulders', 'Cable'),
 ('Overhead Press', 'Shoulders', 'Barbell'),
 ('Dumbbell Shoulder Press', 'Shoulders', 'Dumbbell'),
 ('Lateral Raise', 'Shoulders', 'Dumbbell'),
 ('Rear Delt Fly', 'Shoulders', 'Dumbbell'),
 ('Barbell Curl', 'Arms', 'Barbell'),
 ('Dumbbell Curl', 'Arms', 'Dumbbell'),
 ('Hammer Curl', 'Arms', 'Dumbbell'),
 ('Triceps Pushdown', 'Arms', 'Cable'),
 ('Skull Crusher', 'Arms', 'Barbell'),
 ('Overhead Triceps Extension', 'Arms', 'Dumbbell'),
 ('Squat', 'Legs', 'Barbell'),
 ('Front Squat', 'Legs', 'Barbell'),
 ('Romanian Deadlift', 'Legs', 'Barbell'),
 ('Leg Press', 'Legs', 'Machine'),
 ('Bulgarian Split Squat', 'Legs', 'Dumbbell'),
 ('Lunge', 'Legs', 'Dumbbell'),
 ('Leg Extension', 'Legs', 'Machine'),
 ('Leg Curl', 'Legs', 'Machine'),
 ('Hip Thrust', 'Legs', 'Barbell'),
 ('Calf Raise', 'Legs', 'Machine'),
 ('Plank', 'Core', 'Bodyweight'),
 ('Hanging Leg Raise', 'Core', 'Bodyweight'),
 ('Cable Crunch', 'Core', 'Cable'),
 ('Ab Wheel Rollout', 'Core', 'Other');
