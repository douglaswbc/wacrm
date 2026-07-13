-- ============================================================
-- 041_flows_ai_nodes
--
-- Adds ai_condition and ai_extract to the flow_nodes.node_type
-- CHECK constraint. These nodes use the AI Assistant config
-- (Settings → AI Assistant) for LLM-based branching and data
-- extraction within conversational flows.
-- ============================================================

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'ai_condition',
    'ai_extract',
    'set_tag',
    'handoff',
    'end'
  ));
