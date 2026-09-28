-- Owned fixture IDs only; never replace another row.
INSERT OR IGNORE INTO users (id,email,name) VALUES
 ('e2e-admin','e2e-admin@e2e.test','E2E Admin'),
 ('e2e-student-1','e2e-student-1@e2e.test','E2E Student 1'),
 ('e2e-student-2','e2e-student-2@e2e.test','E2E Student 2'),
 ('e2e-student-3','e2e-student-3@e2e.test','E2E Student 3'),
 ('e2e-student-4','e2e-student-4@e2e.test','E2E Student 4'),
 ('e2e-student-5','e2e-student-5@e2e.test','E2E Student 5');
UPDATE users SET role='admin' WHERE id='e2e-admin';
INSERT OR IGNORE INTO membership (user_id,email,status) VALUES
 ('e2e-admin','e2e-admin@e2e.test','approved'),
 ('e2e-student-1','e2e-student-1@e2e.test','approved'),
 ('e2e-student-2','e2e-student-2@e2e.test','approved'),
 ('e2e-student-3','e2e-student-3@e2e.test','approved'),
 ('e2e-student-4','e2e-student-4@e2e.test','approved'),
 ('e2e-student-5','e2e-student-5@e2e.test','pending');
INSERT INTO questions (id,external_id,section,domain,difficulty,skill,stem_html,choices_json,correct_answer,explanation_html,source) VALUES
 ('e2e-core-rw','e2e-core-rw','Reading & Writing','Craft and Structure','Easy','Words in Context','<p>Which word best completes the sentence? The club made a _____ plan.</p>','[{"letter":"A","content":"careful"},{"letter":"B","content":"careless"},{"letter":"C","content":"vague"},{"letter":"D","content":"late"}]','A','<p>E2E_EXPL_MARKER_RW: Careful fits.</p>','College Board'),
 ('e2e-core-math','e2e-core-math','Math','Algebra','Medium','Linear Equations in One Variable','<p>What is \(3 + 4\)?</p>','[{"letter":"A","content":"5"},{"letter":"B","content":"6"},{"letter":"C","content":"7"},{"letter":"D","content":"8"}]','C','<p>E2E_EXPL_MARKER_MATH: 3 + 4 = 7.</p>','College Board'),
 ('e2e-core-spr','e2e-core-spr','Math','Algebra','Easy','Linear Equations in One Variable','<p>Enter the value of 6 / 2.</p>','[]','3','<p>E2E_EXPL_MARKER_SPR: 6 / 2 = 3.</p>','College Board')
ON CONFLICT(id) DO UPDATE SET section=excluded.section, choices_json=excluded.choices_json, stem_html=excluded.stem_html, explanation_html=excluded.explanation_html, correct_answer=excluded.correct_answer;
-- Task05: long passage on existing owned question; keep bank size and original opening sentence for earlier tests.
WITH RECURSIVE paragraphs(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM paragraphs WHERE n<24)
UPDATE questions SET stem_html=stem_html || (SELECT group_concat('<p>Passage paragraph ' || n || ': Careful readers compare evidence, question assumptions, and revisit the source before choosing an answer. Each detail helps explain why the plan matters to the whole club.</p>', '') FROM paragraphs) WHERE id='e2e-core-rw';
INSERT OR IGNORE INTO ai_ids (id) VALUES ('e2e-ai-rw');
-- A completed local lesson usage row exercises Hide all without relying on live-session task03.
INSERT OR IGNORE INTO lessons (id,title,mode,created_by) VALUES (900001,'E2E usage fixture','instructor','e2e-admin');
INSERT OR IGNORE INTO lesson_sessions (id,lesson_id,join_code,status,snapshot_json) VALUES (900001,900001,'E2ESE2','ended','{"title":"E2E usage fixture","mode":"instructor","items":[]}');
INSERT OR IGNORE INTO question_lesson_usage (question_id,session_id) VALUES ('e2e-core-spr',900001);
-- Task03: 55s real outage fixture; subsequent 7s/6s lifecycle questions.
INSERT OR IGNORE INTO lessons (id,title,mode,created_by) VALUES (900002,'E2E realtime room','instructor','e2e-admin');
INSERT OR IGNORE INTO lesson_questions (lesson_id,position,question_id,time_limit_sec,notes) VALUES
 (900002,0,'e2e-core-rw',55,'E2E_NOTES_MARKER_LIVE'),
 (900002,1,'e2e-core-math',7,''),
 (900002,2,'e2e-core-spr',6,'');
-- Admin dashboard owned demo attempts: legacy unknown plus prospective direction and timed history.
INSERT OR IGNORE INTO progress (user_id,question_id,attempts,corrects,marker,last_reviewed,time_taken_ms) VALUES
 ('e2e-student-1','e2e-core-rw',2,0,'Red','2026-09-23T12:00:00Z',42000),
 ('e2e-student-1','e2e-core-math',2,1,'Orange','2026-09-23T12:01:00Z',97000),
 ('e2e-student-1','e2e-core-spr',1,1,'Green','2026-09-23T12:02:00Z',68000),
 ('e2e-student-1','e2e-ai-rw',1,0,'Red','2026-09-23T12:04:00Z',110000);
INSERT OR IGNORE INTO attempts (user_id,question_id,ts,correct,time_taken_ms,picked,changes,answer_history_json) VALUES
 ('e2e-student-1','e2e-core-rw','2026-09-23T12:00:00Z',0,42000,'B',1,'[{"answer":"A","atMs":100},{"answer":"B","atMs":400}]'),
 ('e2e-student-1','e2e-core-math','2026-09-23T12:01:00Z',1,97000,'C',1,'[{"answer":"B","atMs":100},{"answer":"C","atMs":400}]'),
 ('e2e-student-1','e2e-core-spr','2026-09-23T12:02:00Z',1,68000,'3',0,'[{"answer":"3","atMs":100}]'),
 ('e2e-student-1','e2e-core-rw','2026-09-23T12:03:00Z',0,71000,'B',NULL,NULL),
 ('e2e-student-1','e2e-ai-rw','2026-09-23T12:04:00Z',0,110000,'B',0,NULL);
-- A corrected SPR remains a real read-only mistake preview; earlier miss proves Orange history.
UPDATE progress SET attempts=2, corrects=1, marker='Orange' WHERE user_id='e2e-student-1' AND question_id='e2e-core-spr';
INSERT OR IGNORE INTO attempts (user_id,question_id,ts,correct,time_taken_ms,picked,changes) VALUES
 ('e2e-student-1','e2e-core-spr','2026-09-23T11:59:00Z',0,60000,'2',0);
-- Enough ordered history rows for real server pagination; no fixed exam/session rows.
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<29)
INSERT OR IGNORE INTO attempts (user_id,question_id,ts,correct,time_taken_ms,picked,changes)
SELECT 'e2e-student-1','e2e-core-math',printf('2026-09-22T10:%02d:00Z',i),i%2,90000,CASE WHEN i%2=1 THEN 'C' ELSE 'B' END,0 FROM n;
-- Task09: student 6 takes the self-paced lessons (they write practice stats; student 1's stay fixed).
INSERT OR IGNORE INTO users (id,email,name) VALUES ('e2e-student-6','e2e-student-6@e2e.test','E2E Student 6');
INSERT OR IGNORE INTO membership (user_id,email,status) VALUES ('e2e-student-6','e2e-student-6@e2e.test','approved');
-- Task09 bank filter: one question per skill, used in a lesson student 6 attended / one they did not / never.
-- No lesson session using these is ever ended, so their usage never changes between runs. Task 11a's
-- laser spec shows e2e-unused (passage + prompt) and e2e-used-other (figure) live and leaves them open.
INSERT INTO questions (id,external_id,section,domain,difficulty,skill,stem_html,choices_json,correct_answer,explanation_html,source) VALUES
 ('e2e-used-mine','e2e-used-mine','Reading & Writing','Expression of Ideas','Easy','Transitions','<p>Which transition fits? The plan worked. _____, the club kept it.</p>','[{"letter":"A","content":"Therefore"},{"letter":"B","content":"However"},{"letter":"C","content":"Instead"},{"letter":"D","content":"Meanwhile"}]','A','<p>Therefore fits the result.</p>','College Board'),
 ('e2e-used-other','e2e-used-other','Reading & Writing','Expression of Ideas','Easy','Rhetorical Synthesis','<div class="qfig"><img src="data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 380 200'' width=''380'' height=''200''%3E%3Crect width=''380'' height=''200'' fill=''%23fff''/%3E%3Cg font-family=''sans-serif'' font-size=''14'' fill=''%23171717''%3E%3Ctext x=''190'' y=''22'' text-anchor=''middle''%3EClub hours last month%3C/text%3E%3Ctext x=''10'' y=''60''%3EPractice%3C/text%3E%3Crect x=''90'' y=''40'' width=''240'' height=''28'' fill=''%231869b6''/%3E%3Ctext x=''336'' y=''60''%3E24%3C/text%3E%3Ctext x=''10'' y=''110''%3EReading%3C/text%3E%3Crect x=''90'' y=''90'' width=''90'' height=''28'' fill=''%231869b6''/%3E%3Ctext x=''186'' y=''110''%3E9%3C/text%3E%3Ctext x=''10'' y=''160''%3ETrips%3C/text%3E%3Crect x=''90'' y=''140'' width=''30'' height=''28'' fill=''%231869b6''/%3E%3Ctext x=''126'' y=''160''%3E3%3C/text%3E%3C/g%3E%3C/svg%3E" alt="Bar chart of club hours last month: practice 24, reading 9, trips 3"></div><p>The chart shows how the club spent its hours last month. Which choice best states the goal of the club, based on the chart?</p>','[{"letter":"A","content":"To practice together"},{"letter":"B","content":"To stop meeting"},{"letter":"C","content":"To sell books"},{"letter":"D","content":"To travel"}]','A','<p>The notes stress practice.</p>','College Board'),
 ('e2e-unused','e2e-unused','Reading & Writing','Standard English Conventions','Easy','Boundaries','<p>Scientists once pictured a forest as a crowd of rivals, each tree racing its neighbors for light. Studies of underground fungal networks tell a different story. Through these threads, one tree can pass sugar and water to another, and a seedling growing in deep shade may survive on what larger plants share with it. When insects attack a single tree, chemical signals can travel through the same network and prompt nearby plants to raise their own defenses. The researchers followed one network for two _____ they found that shared sugar reached almost every seedling in the plot.</p><h3>Prompt</h3><p>Which choice completes the text so that it conforms to the conventions of Standard English?</p>','[{"letter":"A","content":"years,"},{"letter":"B","content":"years;"},{"letter":"C","content":"years"},{"letter":"D","content":"years:"}]','B','<p>A semicolon joins two clauses.</p>','College Board')
ON CONFLICT(id) DO UPDATE SET section=excluded.section, domain=excluded.domain, skill=excluded.skill, choices_json=excluded.choices_json, stem_html=excluded.stem_html, explanation_html=excluded.explanation_html, correct_answer=excluded.correct_answer;
INSERT OR IGNORE INTO lessons (id,title,mode,created_by) VALUES (900003,'E2E attended fixture','instructor','e2e-admin'),(900004,'E2E other fixture','instructor','e2e-admin');
INSERT OR IGNORE INTO lesson_sessions (id,lesson_id,join_code,status,snapshot_json) VALUES
 (900003,900003,'E2ESE3','ended','{"title":"E2E attended fixture","mode":"instructor","items":[{"question_id":"e2e-used-mine","time_limit_sec":60,"notes":""}]}'),
 (900004,900004,'E2ESE4','ended','{"title":"E2E other fixture","mode":"instructor","items":[{"question_id":"e2e-used-other","time_limit_sec":60,"notes":""}]}');
INSERT OR IGNORE INTO session_participants (session_id,user_id,assigned_question_ids_json) VALUES
 (900003,'e2e-student-6','["e2e-used-mine"]'),(900004,'e2e-student-2','["e2e-used-other"]');
INSERT OR IGNORE INTO question_lesson_usage (question_id,session_id) VALUES ('e2e-used-mine',900003),('e2e-used-other',900004);
