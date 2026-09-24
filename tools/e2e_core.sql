-- Owned fixture IDs only; never replace another row.
INSERT OR IGNORE INTO users (id,email,name) VALUES
 ('e2e-admin','e2e-admin@e2e.test','E2E Admin'),
 ('e2e-student-1','e2e-student-1@e2e.test','E2E Student 1'),
 ('e2e-student-2','e2e-student-2@e2e.test','E2E Student 2'),
 ('e2e-student-3','e2e-student-3@e2e.test','E2E Student 3'),
 ('e2e-student-4','e2e-student-4@e2e.test','E2E Student 4');
INSERT OR IGNORE INTO membership (user_id,email,status) VALUES
 ('e2e-admin','e2e-admin@e2e.test','approved'),
 ('e2e-student-1','e2e-student-1@e2e.test','approved'),
 ('e2e-student-2','e2e-student-2@e2e.test','approved'),
 ('e2e-student-3','e2e-student-3@e2e.test','approved'),
 ('e2e-student-4','e2e-student-4@e2e.test','approved');
INSERT INTO questions (id,external_id,section,domain,difficulty,skill,stem_html,choices_json,correct_answer,explanation_html,source) VALUES
 ('e2e-core-rw','e2e-core-rw','Reading & Writing','Craft and Structure','Easy','Words in Context','<p>Which word best completes the sentence? The club made a _____ plan.</p>','[{"letter":"A","content":"careful"},{"letter":"B","content":"careless"},{"letter":"C","content":"vague"},{"letter":"D","content":"late"}]','A','<p>E2E_EXPL_MARKER_RW: Careful fits.</p>','College Board'),
 ('e2e-core-math','e2e-core-math','Math','Algebra','Medium','Linear Equations in One Variable','<p>What is 3 + 4?</p>','[{"letter":"A","content":"5"},{"letter":"B","content":"6"},{"letter":"C","content":"7"},{"letter":"D","content":"8"}]','C','<p>E2E_EXPL_MARKER_MATH: 3 + 4 = 7.</p>','College Board'),
 ('e2e-core-spr','e2e-core-spr','Math','Algebra','Easy','Linear Equations in One Variable','<p>Enter the value of 6 / 2.</p>','[]','3','<p>E2E_EXPL_MARKER_SPR: 6 / 2 = 3.</p>','College Board')
ON CONFLICT(id) DO UPDATE SET section=excluded.section, choices_json=excluded.choices_json, stem_html=excluded.stem_html, explanation_html=excluded.explanation_html, correct_answer=excluded.correct_answer;
INSERT OR IGNORE INTO ai_ids (id) VALUES ('e2e-ai-rw');
