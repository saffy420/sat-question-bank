-- Three AI rows filed Cross-Text Connections under Information and Ideas, so the
-- topic dropdown listed the skill twice. The skill belongs to Craft and Structure.
UPDATE questions SET domain = 'Craft and Structure'
 WHERE skill = 'Cross-Text Connections' AND domain <> 'Craft and Structure';
