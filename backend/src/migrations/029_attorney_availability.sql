-- Migration 029: attorney weekly availability grid
-- Stores attorney's typical weekly schedule as JSON.
-- Format: { mon: ['morning','afternoon'], tue: ['afternoon','evening'], ... }
-- Days: mon tue wed thu fri sat sun
-- Slots: morning (8am-12pm), afternoon (12pm-5pm), evening (5pm-8pm)

ALTER TABLE lawyers ADD COLUMN weekly_availability TEXT DEFAULT NULL;
ALTER TABLE lawyers ADD COLUMN availability_note TEXT DEFAULT NULL;
-- availability_note: free-text note (e.g. "Best to reach me Tuesday mornings")
