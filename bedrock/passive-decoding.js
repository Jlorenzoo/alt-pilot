'use strict'

// This client does not render or mine world blocks, play sounds, or display particles.
// Dropping heavy render-only and sound/particle packets before ProtoDef decoding
// prevents massive array decoding loops and GC pressure from starving chat and health timers.
// All gameplay packets (chat, player position, inventory, attributes, scoreboard, dimension
// changes, routing, and disconnects) retain the original decoder and validation.
const IGNORED_PACKET_NAMES = new Set([
  'update_subchunk_blocks',
  'level_chunk',
  'subchunk',
  'level_sound_event',
  'level_sound_event_v2',
  'level_sound_event_old',
  'play_sound',
  'stop_sound',
  'clientbound_update_sound_data',
  'level_event',
  'level_event_generic',
  'spawn_particle_effect',
  'move_entity_delta',
  'set_entity_motion',
  'set_entity_data',
  'entity_event',
  'animate_entity',
  'add_item_entity',
  'take_item_entity',
  'block_entity_data',
  'update_block',
  'update_block_synced',
  'update_block_properties',
  'motion_prediction_hints',
  'clientbound_map_item_data',
  'network_chunk_publisher_update',
  'block_event',
  'chunk_radius_update',
  'sync_entity_property',
  'add_volume_entity',
  'remove_volume_entity',
  'camera_shake',
  'player_fog',
  'debug_info',
  'camera_instruction',
  'camera_presets',
  'camera',
  'trim_data',
  'voxel_shapes',
  'client_cache_status',
  'client_cache_blob_status',
  'client_cache_miss_response',
  'movement_effect',
  'set_movement_authority',
  'client_movement_prediction_sync',
  'clientbound_attribute_layer_sync',
  'available_commands',
  'crafting_data',
  'creative_content',
  'biome_definition_list',
  'compressed_biome_definitions',
  'available_entity_identifiers'
])

function configurePassiveDecoding (client) {
  const read = client.readPacket
  let ignoredIds
  client.readPacket = function (packet) {
    if (ignoredIds === undefined) {
      try {
        const version = client.options.version || '1.26.51'
        const data = require('minecraft-data')('bedrock_' + version)
        const mappings = data.protocol.types.mcpe_packet[1][0].type[1].mappings
        ignoredIds = new Set()
        for (const [id, name] of Object.entries(mappings)) {
          if (IGNORED_PACKET_NAMES.has(name)) ignoredIds.add(Number(id))
        }
      } catch {
        ignoredIds = new Set([172])
      }
    }
    let header = 0, complete = false
    for (let i = 0; i < Math.min(packet.length, 5); i++) {
      header |= (packet[i] & 0x7f) << (7 * i)
      if (!(packet[i] & 0x80)) { complete = true; break }
    }
    if (complete && ignoredIds.has(header & 0x3ff)) {
      client.emit('alt-pilot-network-activity')
      return
    }
    return read.call(this, packet)
  }
}

module.exports = { configurePassiveDecoding, IGNORED_PACKET_NAMES }

