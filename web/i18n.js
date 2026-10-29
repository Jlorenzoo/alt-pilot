(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.i18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'afk-lang';

  const TRANSLATIONS = {
    en: {
      service_progress_checking: "Checking for another active session…",
      service_progress_sending: "Sending the request to the VM…",
      service_progress_confirming: "Request accepted. Waiting for the VM to confirm the client state…",
      service_progress_start_label: "Starting…",
      service_progress_start_title: "Starting the client",
      service_progress_stop_label: "Stopping…",
      service_progress_stop_title: "Stopping the client",
      service_progress_restart_label: "Restarting…",
      service_progress_restart_title: "Restarting the client",
      service_progress_timeout: "The request was accepted, but the final state could not be confirmed yet. Refresh status before retrying.",

      // Sidebar & Navigation
      brand_tag: 'Minecraft client control',
      nav_overview: 'Overview',
      nav_availability: 'Availability',
      accounts_heading: 'Accounts',
      connection_inspector: 'Connection & resources',
      accounts_online: 'online',
      console_filter_conversation: 'Conversation',
      console_filter_attention: 'Issues',
      console_filter_all_messages: 'All messages',
      console_source: 'By source',
      console_newest_bottom: 'Newest at the bottom',
      console_showing: '{visible} of {total} messages',
      console_source_player: 'Chat',
      console_source_whisper: 'Whisper',
      console_source_server: 'Server',
      console_source_self: 'You',
      console_source_client: 'Client',

      topbar_availability: 'Account availability & downtime',
      nav_setup: 'Account setup',
      nav_voting: 'Voting',
      nav_settings: 'Settings',
      nav_calculator: 'Calculator',
      sidebar_security_note: 'Sessions run on cloud VMs',
      lang_label: 'Language',

      // Topbar Eyebrows & Controls
      topbar_overview: 'Complex Gaming · Java & Bedrock',
      topbar_setup: 'Account setup',
      topbar_voting: 'Server vote rewards',
      topbar_settings: 'ALT Pilot dashboard',
      topbar_calculator: 'IGM / GC profit tools',
      topbar_add_account: 'Add account',
      topbar_remove_account: 'Remove account',
      topbar_start_client: 'Start client',
      topbar_stop_client: 'Stop client',
      topbar_restart_client: 'Restart client',
      topbar_sign_out: 'Sign out',
      account_menu_edit: 'Edit',
      account_menu_remove: 'Remove',

      // Settings Tabs in Topbar
      tab_game: 'Client',
      tab_account: 'Account',
      tab_performance: 'Resources',
      tab_remote: 'Remote access',

      // Overview Hero Status
      status_checking: 'Checking',
      status_reading_vm: 'Reading the VM',
      status_reading_desc: 'This usually takes a few seconds.',
      status_client_stopped: 'Client is stopped',
      status_client_stopped_desc: 'Start it when setup and sign-in are complete.',
      status_vm_unavailable: 'VM unavailable',
      status_vm_unavailable_title: 'The VM could not be reached',
      status_connected: 'Connected',
      status_alt_online: 'Your alt is online',
      status_alt_online_desc: 'The headless client has an active Minecraft connection to {server}.',
      status_connection_dropped: 'Connection dropped',
      status_connection_dropped_title: 'The client reached the server, then disconnected',
      status_connection_dropped_desc: 'The connection watchdog is confirming the drop and will restart this account automatically.',
      status_starting: 'Starting',
      status_starting_title: 'Starting the client',
      status_starting_desc: 'Live startup activity appears below.',
      status_starting_req_desc: 'Sending the request to the VM…',
      status_retrying: 'Retrying',
      status_retrying_title: 'The client is retrying startup',
      status_retrying_desc: 'A previous launch ended early. The service will retry automatically and this page will keep updating.',
      status_failed: 'Start failed',
      status_failed_title: 'The client could not start',
      status_failed_desc: 'The service stopped with exit status {status}. Use Restart to try again.',
      status_setup_needed: 'Setup needed',
      status_setup_needed_title: 'The VM needs the secure install',
      status_setup_needed_desc: 'Continue the guided setup to install and configure the client.',
      status_signin_needed: 'Sign-in needed',
      status_signin_needed_title: 'Minecraft needs authorization',
      status_signin_needed_desc: 'Use Microsoft’s device-code flow. Your password never enters this app.',

      // Presence Meta
      presence_selected_account: 'Selected account',
      presence_configure_account: 'Configure this account',
      presence_checking_detail: 'Checking the client and VM connection.',
      presence_connected_detail: 'Connected to Minecraft and ready for console commands.',
      presence_active_detail: 'The client is active; connection state updates automatically.',
      presence_idle_detail: 'Start and restart controls are in the top-right corner.',

      // Resource Metrics
      metric_server: 'Server',
      metric_version: 'Version',
      metric_running_since: 'Running since',
      metric_memory: 'Memory',
      metric_swap: 'Swap',
      metric_disk: 'Disk used',
      metric_memory_title: 'Selected account · {total} VM total',

      // Activity Console
      item_commands_title: 'Item and chat commands',
      item_commands_intro: 'Java and Bedrock. Only players on your existing whitelist can send these commands.',
      item_commands_use: 'Right-click with the held item.',
      item_commands_drop: 'Drop one held item.',
      item_commands_xp: 'Reply privately with sidebar XP, or an estimate from level and progress.',
      item_commands_help: 'Reply privately with this command list.',
      item_commands_add: 'Allow a player on all accounts.',
      item_commands_remove: 'Remove a player from all accounts.',
      item_commands_restart: 'Restart only the account receiving the command.',
      item_commands_scope: 'Whisper to one alt to target it. Public chat reaches every listening alt. Item actions have a 2-second cooldown.',
      console_title: 'Account console',
      console_help_label: 'Console help',
      console_help_title: 'Console help',
      console_help_lead: 'Type chat normally. Text beginning with / is sent to the server.',
      console_help_cmd_help: 'Show the server command list',
      console_help_cmd_tpaccept: 'Accept a teleport request',
      console_help_cmd_tpcancel: 'Cancel a teleport request',
      console_help_cmd_tpa: 'Request a teleport to a player',
      console_help_cmd_clear: 'Clear only this local view',
      console_filter_all: 'All',
      console_filter_player: 'Chat',
      console_filter_whisper: 'Whispers',
      console_filter_server: 'Server',
      console_filter_self: 'You',
      console_filter_client: 'Client',
      console_search_placeholder: 'Search messages…',
      console_search_label: 'Search console messages',
      console_empty: 'Select an account to load its console.',
      console_empty_cleared: 'Console cleared locally. New activity will appear here.',
      console_unavailable: 'Console unavailable: {error}',
      console_input_placeholder: 'Chat or /command…',
      console_input_aria: 'Chat message or slash command',
      console_send_btn: 'Send',
      item_controls_title: 'Item controls',
      action_use_item: 'right click',
      action_use_item_title: 'Right-click / use held item (e.g. throw XP bottle, eat, use)',
      action_drop_item: 'Q (drop item)',
      action_drop_item_title: 'Drop item held in hand to ground',
      console_joining_server: 'Joining server',
      console_loading_minecraft: 'Loading Minecraft',

      // Setup Steps Navigation
      setup_step_1_title: 'This computer',
      setup_step_1_sub: 'Required tools and SSH key',
      setup_step_2_title: 'Oracle account',
      setup_step_2_sub: 'Sign-in, region and free allowance',
      setup_step_3_title: 'Always Free VM',
      setup_step_3_sub: 'E2.1.Micro and storage guard',
      setup_step_4_title: 'Secure install',
      setup_step_4_sub: 'Lightweight MCC and services',
      setup_step_5_title: 'This account',
      setup_step_5_sub: 'Microsoft sign-in for the selected account',

      // Setup Step 1 Content
      step1_title: 'Check this computer',
      step1_lead: 'The control center needs a few standard command-line tools. This shared check only needs to pass once, no matter how many Minecraft accounts you add.',
      step1_actions_note: 'Read-only check',
      step1_action_btn: 'Run pre-flight',

      // Setup Step 2 Content
      step2_title: 'Verify Oracle Cloud',
      step2_lead: 'Read the shared tenancy, home region, current instances and storage use. This step creates nothing and does not change {name}.',
      step2_callout: 'Cost boundary: the Create action stays locked until the shape, image licensing, instance count and total block storage are all shown as within Always Free.',
      step2_actions_note: 'No Oracle resources are changed',
      step2_action_btn: 'Verify free allowance',

      // Setup Step 3 Content
      step3_title_existing: 'Use the existing VM',
      step3_title_create: 'Create the Always Free VM',
      step3_lead_existing: 'The recorded E2.1.Micro is reachable. This same VM is shared by your saved Minecraft accounts.',
      step3_lead_create: 'Provision one x86 E2.1.Micro only after the dry-run evidence is reviewed. It will be shared by your saved accounts.',
      step3_recorded_instance: 'Recorded instance',
      step3_no_vm: 'No VM recorded',
      step3_confirm_label: 'Type ALWAYS FREE to unlock provisioning',
      step3_actions_note_existing: 'No new cloud resources required',
      step3_actions_note_create: 'Creates an Oracle VM and, only if needed, basic networking',
      step3_action_btn_existing: 'Install on this VM',
      step3_action_btn_create: 'Create free VM',

      // Setup Step 4 Content
      step4_title: 'Install and repair safely',
      step4_lead: 'Apply the lightweight MCC runtime, memory limits, firewall, persistent logs and helper commands.',
      step4_ssh_connection: 'SSH connection',
      step4_ready: 'Ready',
      step4_cluster_runtime: 'Cluster runtime',
      step4_installed_every_host: 'Installed on every host',
      step4_needs_repair: 'Needs repair',
      step4_actions_note: 'Idempotent and safe to repeat',
      step4_action_btn: 'Install or repair',

      // Setup Step 5 Content
      step5_ready_title: '{name} is ready',
      step5_ready_lead: 'The shared VM is prepared and this Minecraft account is signed in. Starting and stopping {name} is managed separately from Overview.',
      step5_signed_in_as: 'Signed in as {name}',
      step5_ready_to_start: 'Account {slot} · ready to start when you choose',
      step5_setup_complete: "This account's one-time setup is complete",
      step5_signin_title: 'Sign in {name}',
      step5_signin_lead: 'Start a device-code flow for this account only. A dialog will show the official Microsoft link and one-time code for Java or Bedrock.',
      step5_signin_callout: 'Your Microsoft password never passes through this control center. The refresh token stays inside this account\'s private profile on its assigned Oracle host.',
      step5_need_free_alt: 'Need a Bedrock alt?',
      step5_free_alt_desc: 'Bedrock accounts need a Microsoft/Xbox profile and an owned Minecraft Bedrock license.',
      step5_guide_link: 'View 2-minute step guide →',
      step5_human_action: 'Human action required for Account {slot}',
      step5_signin_btn: 'Sign in Account {slot}',
      step5_signout_name: 'Sign out {name}',
      step5_signout_slot: 'Sign out Account {slot}',

      // Voting View
      voting_eyebrow: 'Server rewards',
      voting_title: 'Voting',
      voting_lead: 'Vote for Complex Gaming across listing websites to receive daily keys, claim blocks, and rewards. Timers update automatically per site.',
      voting_notify_title: 'Enable browser notifications when a timer expires',
      voting_notify_on: 'Alerts: On',
      voting_notify_off: 'Alerts: Off',
      voting_sound_title: 'Toggle audio chime alert',
      voting_sound_on: 'Sound: On',
      voting_sound_off: 'Sound: Off',
      voting_test_btn: 'Test',
      voting_filter_both: 'Both',
      voting_status_ready: '{count}/8 ready',
      voting_mark_all: 'Mark all',
      voting_mark_all_title: 'Mark all 8 as voted now',
      voting_set_time_title: 'Set vote time for all (e.g. 06:09)',
      voting_reset_all_title: 'Reset all 8 timers to ready',
      voting_site_ready: 'Ready to vote',
      voting_site_voted: 'Voted',
      voting_site_vote_now: 'Vote now ↗',
      voting_site_vote: 'Vote ↗',
      voting_site_in: 'in',
      voting_custom_timer: 'Custom timer',
      voting_custom_interval: 'Custom interval',
      voting_custom_interval_title: 'Click to edit vote cycle hours',
      voting_undo: 'Undo',
      voting_alert_msg: '{player} can vote on {site} now!',

      // Bedrock Account Setup Guide

      // Guide Step 1

      // Guide Step 2

      // Guide Step 3

      // Guide FAQ

      // Settings View
      settings_heading: 'Settings',
      settings_lead: 'Choose an area below. Server, version and RAM changes need a client restart; per-account settings (startup command, TPA auto-accept, purpose) take effect live.',
      settings_kicker_client: 'Minecraft client',
      settings_h3_connection: 'Connection details',
      settings_connection_sub: 'Use the Java server address and the exact Minecraft version it supports.',
      settings_server_label: 'Minecraft server',
      settings_server_small: 'Use the server\'s direct Java address. A port is optional.',
      settings_version_label: 'Minecraft version',
      settings_version_small: '1.12.2 uses little memory, but the selected version must support a real connection.',

      // Settings - Account Tab
      settings_kicker_account: 'Per-Account Configuration',
      settings_h3_account: 'Account settings',
      settings_account_sub: 'Customize startup automation and behavior for each signed-in Minecraft account.',
      settings_select_account: 'Select account',
      settings_assigned_vm: 'Assigned to Oracle VM',
      settings_kicker_alt: 'Alt Identity',
      settings_h3_purpose: 'Purpose & Note',
      settings_purpose_sub: 'Assign a role or note to this alt (e.g. Spawner, Cactus, AFK Pool).',
      settings_purpose_label: 'Alt purpose / role tag',
      settings_purpose_placeholder: 'e.g. Spawner, Cactus, AFK Pool',
      settings_purpose_small: 'Displayed as a tag on account tabs.',

      settings_kicker_startup: 'Startup Automation',
      settings_h3_join_cmd: 'Join command',
      settings_join_cmd_sub: 'Automatically execute a command after connecting and spawning into the server.',
      settings_auto_run_cmd: 'Auto-run command on join',
      settings_auto_run_cmd_sub: 'Sends a command (like /home alt) whenever this account loads into the server or reconnects.',
      settings_startup_cmd_label: 'Startup command',
      settings_startup_cmd_small: 'Command sent to the server (e.g. /home alt or /home farm).',
      settings_delay_label: 'Delay after join',
      settings_delay_2s: '2 seconds',
      settings_delay_3s: '3 seconds',
      settings_delay_5s: '5 seconds (recommended)',
      settings_delay_8s: '8 seconds',
      settings_delay_10s: '10 seconds',
      settings_delay_15s: '15 seconds',
      settings_delay_20s: '20 seconds',
      settings_delay_small: 'Gives the server time to finish loading chunks and spawning before running the command.',

      // Teleport Automation & Whitelist
      settings_kicker_tpa: 'Teleport Automation',
      settings_h3_tpa: 'Auto-accept teleport requests',
      settings_tpa_sub: 'Automatically accept /tpa and /tpahere requests from trusted players.',
      settings_tpa_auto_accept: 'Auto-accept /tpa and /tpahere from whitelist',
      settings_tpa_auto_accept_sub: 'Automatically runs /tpyes when a whitelisted player requests either direction of teleport.',
      settings_whitelisted_players: 'Whitelisted players',
      settings_players_count: '{count} player{s}',
      settings_add_player_placeholder: 'Add player username…',
      settings_add_player_btn: 'Add',
      settings_whitelist_help: 'Press Enter or click Add to append. Click any field above to edit or click × to remove.',
      settings_whitelist_empty_hint: 'No whitelisted players. Type a player username below and press Enter or click Add.',
      settings_tpa_sync_all: 'Apply whitelist to all accounts',
      settings_tpa_sync_all_sub: 'Update and reload every bot with this whitelist on save without restarting.',

      // Settings - Resources Tab
      settings_kicker_resources: 'Client resources',
      settings_h3_memory: 'Memory limit',
      settings_memory_sub: 'These limits keep room for Linux, SSH and Java’s native memory on the 1 GB VM.',
      settings_min_heap: 'Minimum heap',
      settings_min_heap_small: 'Memory reserved when the client starts.',
      settings_max_heap: 'Maximum heap',
      settings_max_heap_small: 'Hard ceiling for the Minecraft client.',
      settings_kicker_vm: 'Oracle VM',
      settings_h3_ssh: 'Remote shell',
      settings_ssh_sub: 'Login name used by the install and repair tools on the selected host.',
      settings_ssh_user: 'SSH user',

      // Settings - Remote Access Tab
      settings_kicker_remote: 'Other devices',
      settings_h3_public_link: 'Public control link',
      settings_public_link_sub: 'Password-protected HTTPS access from another computer or your phone.',
      settings_public_url: 'Public URL',
      settings_open_remote: 'Open remote control ↗',
      settings_url_temporary: 'Temporary address; it can change if the tunnel restarts.',
      settings_url_stable: 'Stable address',
      settings_kicker_security: 'Security',
      settings_h3_password: 'Control password',
      settings_password_sub: 'Set the password used by this public control page.',
      settings_new_password: 'New password',
      settings_password_min_chars: 'Use at least 12 characters.',
      settings_confirm_password: 'Confirm password',
      settings_password_msg_default: 'Existing signed-in sessions stay active.',
      settings_change_password_btn: 'Change password',
      settings_remote_unavailable_title: 'Remote access is not set up',
      settings_remote_unavailable_desc: 'Complete the secure install in Account setup to create a public control link.',
      settings_save_msg: 'Per-account changes apply live; server/version/RAM need a restart.',
      settings_save_btn: 'Save',
      settings_saving_btn: 'Saving…',
      settings_saved_btn: 'Saved ✓',

      // Auth Modal
      auth_eyebrow: 'Secure device sign-in',
      auth_title: 'Connect a Microsoft account',
      auth_connect_name: 'Connect {name}',
      auth_close_label: 'Close sign-in dialog',
      auth_lead: 'Choose Java, Bedrock, or both for the same Microsoft account:',
      auth_card_java_badge: 'PC Standard',
      auth_card_java_title: 'Java Edition',
      auth_card_java_desc: 'Standard PC accounts & Java alts',
      auth_card_bedrock_badge: 'Xbox / Mobile',
      auth_card_bedrock_title: 'Bedrock Edition',
      auth_card_bedrock_desc: 'Console, Xbox, or names with a dot prefix (e.g. .username)',
      auth_card_both_badge: 'Same Microsoft account',
      auth_card_both_title: 'Java + Bedrock',
      auth_card_both_desc: 'Verifies Java, then adds Bedrock. An already-saved Java account is reused; nothing needs to be removed.',
      auth_hint_q: 'Which one should I choose?',
      auth_hint_text: 'Use Java + Bedrock for both identities from one Microsoft account. If Java is already saved, only the new Bedrock identity is added.',
      auth_hint_link: 'How to set up Bedrock →',
      auth_connecting_bedrock: 'Connecting Bedrock Edition (.alt)',
      auth_connecting_java: 'Connecting Java Edition (PC)',
      auth_connecting_both: 'Verifying Java, then Bedrock',
      auth_both_step1: 'Step 1 of 2: Verifying Java Edition',
      auth_both_step2: 'Step 2 of 2: Adding Bedrock Edition',
      auth_both_step2_status: 'Java verified! Enter this second code at Microsoft to connect Bedrock.',
      auth_switch_edition: '← Switch edition',
      auth_step1_title: 'Choose the Microsoft account',
      auth_step1_sub: 'Microsoft asks which account to use before the code.',
      auth_step2_title: 'Confirm the code',
      auth_step2_sub: 'Paste the code below if Microsoft still asks for it.',
      auth_open_microsoft: 'Open Microsoft sign-in',
      auth_link_preparing: 'Preparing sign-in page…',
      auth_link_failed: 'Sign-in did not finish',
      auth_code_label: 'One-time code',
      auth_code_preparing: 'Preparing…',
      auth_code_see_ms: 'See Microsoft',
      auth_copy_btn: 'Copy',
      auth_copied_btn: 'Copied',
      auth_status_starting: 'Starting a secure sign-in session…',
      auth_status_ready: 'Ready. Open Microsoft, choose the account, then confirm the code.',
      auth_status_waiting_code: 'Microsoft’s page is ready. Waiting for the one-time code…',
      auth_status_approving: 'Microsoft approved! Validating gamer profile…',
      auth_status_preparing_bedrock: 'Java verified! Preparing Bedrock sign-in code…',
      auth_status_failed: 'Microsoft did not confirm the sign-in. Try again for a new code.',
      auth_retry_hint: 'Request a new Microsoft code. The previous sign-in was stopped.',
      auth_retry_btn: 'Try again',
      auth_foot: 'You can close this dialog while sign-in continues. We’ll detect approval automatically.',
      auth_switch_java_not_found: 'No Java profile found for this Microsoft account. Did you mean to sign in as Bedrock?',
      auth_switch_java_btn: 'Switch to Bedrock & Try Again',
      auth_switch_bedrock_not_found: 'Bedrock profile was not found. Did you mean to sign in as Java?',
      auth_switch_bedrock_btn: 'Switch to Java & Try Again',
      auth_bedrock_no_license: 'Mojang rejected Bedrock multiplayer for this Microsoft account. If you own Java, Bedrock is already included! However, you must launch Minecraft Bedrock at least once on this account before connecting.',
      auth_view_guide_btn: 'How to set up Bedrock →',
      auth_view_help_btn: 'How to set up Bedrock →',

      // Bedrock Account Setup Helper
      bedrock_help_eyebrow: 'Bedrock Account Setup',
      bedrock_help_title: 'How to Set Up Bedrock',
      bedrock_help_java_title: 'Already have a Microsoft Java account?',
      bedrock_help_java_desc: 'Every Microsoft account that owns Minecraft Java Edition already owns Bedrock Edition for PC at no extra cost (it is included in the official Minecraft bundle).',
      bedrock_help_launch_warn: 'Important requirement: You must launch Minecraft Bedrock at least once on this Microsoft account (via the Minecraft Launcher on PC, console, or mobile) before ALT Pilot can authenticate. Opening Bedrock initializes your Xbox player identity and Bedrock multiplayer license with Mojang. Without this one-time launch, sign-in will fail with UNAUTHORIZED.',
      bedrock_help_alt_title: 'Setting up a separate Bedrock alt?',
      bedrock_help_alt_step1: 'Create a free Microsoft account with birth year 18+ (required for online multiplayer without parental locks).',
      bedrock_help_alt_step2: 'Claim your Xbox Gamertag on xbox.com (or in the Minecraft Launcher).',
      bedrock_help_alt_step3: 'Launch Minecraft Bedrock at least once with that account to activate the profile.',
      bedrock_help_connect_title: 'Connecting in ALT Pilot',
      bedrock_help_connect_desc: 'Choose "Java + Bedrock" to link both identities from one Microsoft account (Java stays active, and Bedrock is added as a companion alt). Or choose "Bedrock Edition" for a standalone alt. Bedrock alts join Floodgate servers like Complex Skyblock with a dot prefix (e.g. .Username).',
      bedrock_help_close: 'Got it',
      bedrock_help_cta: 'Open Account Setup',

      // Pre-Start Modal
      pre_start_eyebrow: 'Heads-up before starting',
      pre_start_title: 'Another session may be active',
      pre_start_close_label: 'Close warning',
      pre_start_intro: 'Starting {name} can affect another active Minecraft session.',
      pre_start_foot: 'If you are sure no one is currently playing on that account, click Start anyway. Otherwise, close this dialog and stop the other session first.',
      pre_start_cancel: 'Cancel',
      pre_start_confirm: 'Start anyway',

      // Task Drawer
      task_working: 'Working…',
      task_starting: 'Starting…',
      task_sending_req: 'Sending the request to the VM…',
      task_done: 'Done',
      task_failed: 'Action failed',
      task_accepted: 'Start accepted — loading continues',
      task_start_name: 'Starting {name}',
      task_restart_name: 'Restarting {name}',
      task_stop_name: 'Stopping {name}',
      task_signout_name: 'Signing out {name}',
      task_save_account: 'Saving settings for {name}',
      task_save_client: 'Saving client settings',

      // Dialogs & Confirmations
      confirm_disconnect_name: 'Disconnect {name}? The Oracle VM will stay running.',
      confirm_start_all: 'Run every signed-in Minecraft account across the Oracle hosts?',
      confirm_stop_all: 'Disconnect every Minecraft account? Both Oracle hosts will stay running.',
      confirm_signout_name: 'Remove {name}? This stops the client and deletes its saved Microsoft session. You will need to sign in again to add it back.',

      // Alerts & Errors
      alert_wait_task: 'Wait for the current action to finish before starting another sign-in.',
      alert_headsup_failed: 'Heads-up check failed: {error}. Starting anyway.',
      alert_enter_chat_cmd: 'Enter a chat message or slash command.',
      alert_password_length: 'Use at least 12 characters for the control password.',
      alert_password_mismatch: 'The password confirmation does not match.',
      alert_notifications_unsupported: 'Desktop notifications are not supported in this browser.',
      alert_password_changed: 'Password changed successfully.',
      alert_settings_saved: 'Settings saved.',
      alert_username_format: 'Player username must be 1–16 characters (letters, numbers, underscores).',
      alert_already_whitelisted: '{name} is already in the whitelist.',
      alert_files_out_of_sync: 'The dashboard files are out of sync. Reload the page before starting this account.',

      // Additional Hero, Controls, Scope & Modals
      ctrl_stop_client: 'Stop client',
      ctrl_start_client: 'Start client',
      status_pill_not_connected: 'Not connected',
      hero_title_stopped: 'Client is stopped',
      hero_desc_stopped: 'Start it when setup and sign-in are complete.',
      status_pill_vm_unavailable: 'VM unavailable',
      hero_title_vm_unavailable: 'The VM could not be reached',
      hero_desc_vm_unavailable: 'Check the VM state and SSH connection in the setup wizard.',
      status_pill_connected: 'Connected',
      hero_title_online: 'Your alt is online',
      hero_desc_online: 'The headless client has an active Minecraft connection to {server}.',
      status_pill_connection_dropped: 'Connection dropped',
      hero_title_dropped: 'The client reached the server, then disconnected',
      hero_desc_dropped: 'The connection watchdog is confirming the drop and will restart this account automatically.',
      status_pill_starting: 'Starting',
      hero_title_starting: 'Starting the client',
      hero_desc_starting: 'Live startup activity appears below.',
      hero_desc_sending_req: 'Sending the request to the VM…',
      status_pill_retrying: 'Retrying',
      hero_title_retrying: 'The client is retrying startup',
      hero_desc_retrying: 'A previous launch ended early. The service will retry automatically and this page will keep updating.',
      status_pill_start_failed: 'Start failed',
      hero_title_failed: 'The client could not start',
      hero_desc_failed: 'The service stopped with exit status {status}. Use Restart to try again.',
      status_pill_setup_needed: 'Setup needed',
      hero_title_setup_needed: 'The VM needs the secure install',
      hero_desc_setup_needed: 'Continue the guided setup to install and configure the client.',
      status_pill_signin_needed: 'Sign-in needed',
      hero_title_signin_needed: 'Minecraft needs authorization',
      hero_desc_signin_needed: 'Use Microsoft’s device-code flow. Your password never enters this app.',
      conn_detail_connected: 'Connected to Minecraft and ready for console commands.',
      conn_detail_active: 'The client is active; connection state updates automatically.',
      conn_detail_controls: 'Start and restart controls are in the top-right corner.',
      setup_scope_hint: 'Steps 1–4 prepare the shared Oracle VM. Step 5 signs in {name} only.',
      wizard_scope_shared: 'Shared VM step · applies to every saved account',
      wizard_scope_account: 'This account only · {name}',
      step2_cost_boundary: '<strong>Cost boundary:</strong> the Create action stays locked until the shape, image licensing, instance count and total block storage are all shown as within Always Free.',
      step3_type_confirm: 'Type ALWAYS FREE to unlock provisioning',
      voting_notify_blocked: 'Alerts: Blocked',
      pre_start_title_restart: 'Restart may disturb another session',
      pre_start_confirm_restart: 'Restart anyway',

      // Calculator view
      calc_eyebrow: 'Trading tools',
      calc_title: 'IGM ↔ GC profit calculator',
      calc_lead: 'Enter what you pay and what you receive. Profit is shown per 64-item stack.',
      calc_rate_title: 'Current rate',
      calc_rate_lead: 'How many IGM one GC is worth right now. Stored locally on this device.',
      calc_rate_label: 'IGM per 1 GC',
      calc_rate_hint: 'Update this whenever the market moves — even every minute if you want.',
      calc_rate_saved: 'Saved',
      calc_buy_title: 'You buy',
      calc_sell_title: 'You sell',
      calc_qty_label: 'Quantity',
      calc_fee_label: 'AH fee',
      calc_unit_custom: 'Custom',
      calc_for_n: 'for',
      calc_miss_rate: 'rate',
      calc_miss_qty: 'quantity',
      calc_miss_buy: 'buy price',
      calc_miss_sell: 'sell price',
      calc_enter_prefix: 'Enter',
      calc_enter_suffix: 'to see profit.',
      calc_fee_weekday: 'Weekday',
      calc_fee_sunday: 'Sunday',
      calc_buy_per_item: 'Cost per item',
      calc_sell_per_item: 'Revenue per item (gross)',
      calc_total_cost: 'Total cost',
      calc_total_revenue: 'Total revenue (gross)',
      calc_net_revenue: 'Net revenue',
      calc_profit_yes: 'Profitable',
      calc_profit_no: 'Loss',
      calc_profit_zero: 'Break-even',
      calc_per_item_profit: 'Profit per item',
      calc_stack_profit: 'Profit for the stack',
      calc_per_item: 'per item',
      calc_preset_2m: '2,000,000',
      calc_preset_3m: '3,000,000',
      calc_preset_5m: '5,000,000',
      calc_preset_hint: 'Quick presets',
      calc_item_presets: 'Item presets',
      calc_preset_save: '+ Save current',
      calc_preset_name_prompt: 'Name for this preset (e.g. Votekeys)',
      calc_preset_icon_prompt: 'Icon: paste an image URL, or an emoji (leave empty for default)',
      calc_preset_delete: 'Delete preset',
      calc_net_profit: 'Net profit · 64 stack',
      calc_preset_dialog_title: 'Save preset',
      calc_preset_dialog_name: 'Name',
      calc_preset_dialog_icon: 'Item sprite',
      calc_preset_dialog_cancel: 'Cancel',
      calc_preset_dialog_save: 'Save',
      calc_sprite_search: 'Search items…',
      calc_sprite_empty: 'No matching items',
      calc_sprite_loading: 'Loading items…',
      calc_sprite_selected: 'Selected',
      calc_sprite_more: 'more — type to narrow',
    },

    it: {
      service_progress_checking: "Controllo di altre sessioni attive…",
      service_progress_sending: "Invio della richiesta alla VM…",
      service_progress_confirming: "Richiesta accettata. In attesa della conferma dello stato del client…",
      service_progress_start_label: "Avvio…",
      service_progress_start_title: "Avvio del client",
      service_progress_stop_label: "Arresto…",
      service_progress_stop_title: "Arresto del client",
      service_progress_restart_label: "Riavvio…",
      service_progress_restart_title: "Riavvio del client",
      service_progress_timeout: "Richiesta accettata, ma lo stato finale non è ancora confermato. Aggiorna lo stato prima di riprovare.",

      // Sidebar & Navigation
      brand_tag: 'Controllo client Minecraft',
      nav_overview: 'Panoramica',
      nav_availability: 'Disponibilità',
      accounts_heading: 'Account',
      connection_inspector: 'Connessione e risorse',
      accounts_online: 'online',
      console_filter_conversation: 'Conversazione',
      console_filter_attention: 'Problemi',
      console_filter_all_messages: 'Tutti i messaggi',
      console_source: 'Per origine',
      console_newest_bottom: 'Più recenti in basso',
      console_showing: '{visible} di {total} messaggi',
      console_source_player: 'Chat',
      console_source_whisper: 'Privato',
      console_source_server: 'Server',
      console_source_self: 'Tu',
      console_source_client: 'Client',

      topbar_availability: 'Disponibilità e interruzioni',
      nav_setup: 'Configurazione account',
      nav_voting: 'Votazioni',
      nav_settings: 'Impostazioni',
      nav_calculator: 'Calcolatrice',
      sidebar_security_note: 'Le sessioni girano su VM cloud',
      lang_label: 'Lingua',

      // Topbar Eyebrows & Controls
      topbar_overview: 'Complex Gaming · Java e Bedrock',
      topbar_setup: 'Configurazione account',
      topbar_voting: 'Ricompense votazioni server',
      topbar_settings: 'Pannello di controllo ALT Pilot',
      topbar_calculator: 'Strumenti profitto IGM / GC',
      topbar_add_account: 'Aggiungi account',
      topbar_remove_account: 'Rimuovi account',
      topbar_start_client: 'Avvia client',
      topbar_stop_client: 'Arresta client',
      topbar_restart_client: 'Riavvia client',
      topbar_sign_out: 'Disconnetti',
      account_menu_edit: 'Modifica',
      account_menu_remove: 'Rimuovi',

      // Settings Tabs in Topbar
      tab_game: 'Client',
      tab_account: 'Account',
      tab_performance: 'Risorse',
      tab_remote: 'Accesso remoto',

      // Overview Hero Status
      status_checking: 'Verifica in corso',
      status_reading_vm: 'Lettura della VM',
      status_reading_desc: 'Di solito richiede pochi secondi.',
      status_client_stopped: 'Il client è arrestato',
      status_client_stopped_desc: 'Avvialo al termine della configurazione e dell\'accesso.',
      status_vm_unavailable: 'VM non raggiungibile',
      status_vm_unavailable_title: 'Impossibile raggiungere la VM',
      status_connected: 'Connesso',
      status_alt_online: 'Il tuo alt è online',
      status_alt_online_desc: 'Il client headless ha una connessione Minecraft attiva a {server}.',
      status_connection_dropped: 'Connessione interrotta',
      status_connection_dropped_title: 'Il client ha raggiunto il server, poi si è disconnesso',
      status_connection_dropped_desc: 'Il watchdog di connessione sta confermando l\'interruzione e riavvierà questo account automaticamente.',
      status_starting: 'Avvio in corso',
      status_starting_title: 'Avvio del client',
      status_starting_desc: 'L\'attività di avvio dal vivo apparirà in basso.',
      status_starting_req_desc: 'Invio della richiesta alla VM in corso…',
      status_retrying: 'Nuovo tentativo',
      status_retrying_title: 'Il client sta riprovando l\'avvio',
      status_retrying_desc: 'Un avvio precedente è terminato anticipatamente. Il servizio riproverà automaticamente e questa pagina continuerà ad aggiornarsi.',
      status_failed: 'Avvio non riuscito',
      status_failed_title: 'Impossibile avviare il client',
      status_failed_desc: 'Il servizio si è arrestato con codice di uscita {status}. Usa Riavvia per riprovare.',
      status_setup_needed: 'Configurazione richiesta',
      status_setup_needed_title: 'La VM necessita dell\'installazione sicura',
      status_setup_needed_desc: 'Continua la procedura guidata per installare e configurare il client.',
      status_signin_needed: 'Accesso richiesto',
      status_signin_needed_title: 'Minecraft richiede l\'autorizzazione',
      status_signin_needed_desc: 'Usa la procedura con codice dispositivo Microsoft. La tua password non passa mai per questa app.',

      // Presence Meta
      presence_selected_account: 'Account selezionato',
      presence_configure_account: 'Configura questo account',
      presence_checking_detail: 'Verifica della connessione del client e della VM in corso.',
      presence_connected_detail: 'Connesso a Minecraft e pronto per i comandi da console.',
      presence_active_detail: 'Il client è attivo; lo stato della connessione si aggiorna automaticamente.',
      presence_idle_detail: 'I comandi di avvio e riavvio si trovano in alto a destra.',

      // Resource Metrics
      metric_server: 'Server',
      metric_version: 'Versione',
      metric_running_since: 'Attivo da',
      metric_memory: 'Memoria',
      metric_swap: 'Swap',
      metric_disk: 'Disco usato',
      metric_memory_title: 'Account selezionato · {total} totale VM',

      // Activity Console
      item_controls_title: 'Controlli oggetti',
      item_commands_title: 'Comandi oggetti e chat',
      item_commands_intro: 'Java e Bedrock. Solo i giocatori nella whitelist possono usare questi comandi.',
      item_commands_use: 'Usa l’oggetto in mano con il clic destro.',
      item_commands_drop: 'Lascia cadere un solo oggetto dalla mano.',
      item_commands_xp: 'Risponde in privato con gli XP della barra laterale o una stima dal livello.',
      item_commands_help: 'Risponde in privato con l’elenco dei comandi.',
      item_commands_add: 'Autorizza un giocatore su tutti gli account.',
      item_commands_remove: 'Rimuove un giocatore da tutti gli account.',
      item_commands_restart: 'Riavvia solo l’account che riceve il comando.',
      item_commands_scope: 'Scrivi in privato a un alt per selezionarlo. La chat pubblica raggiunge tutti gli alt in ascolto. Attendi 2 secondi tra le azioni.',
      console_title: 'Console account',
      console_help_label: 'Guida console',
      console_help_title: 'Guida console',
      console_help_lead: 'Scrivi in chat normalmente. I messaggi che iniziano con / vengono inviati al server.',
      console_help_cmd_help: 'Mostra l\'elenco dei comandi del server',
      console_help_cmd_tpaccept: 'Accetta una richiesta di teletrasporto',
      console_help_cmd_tpcancel: 'Annulla una richiesta di teletrasporto',
      console_help_cmd_tpa: 'Richiedi il teletrasporto verso un giocatore',
      console_help_cmd_clear: 'Pulisci solo questa vista locale',
      console_filter_all: 'Tutti',
      console_filter_player: 'Chat',
      console_filter_whisper: 'Sussurri',
      console_filter_server: 'Server',
      console_filter_self: 'Tu',
      console_filter_client: 'Client',
      console_search_placeholder: 'Cerca messaggi…',
      console_search_label: 'Cerca nei messaggi della console',
      console_empty: 'Seleziona un account per caricare la sua console.',
      console_empty_cleared: 'Console pulita localmente. La nuova attività apparirà qui.',
      console_unavailable: 'Console non disponibile: {error}',
      console_input_placeholder: 'Chat o /comando…',
      console_input_aria: 'Messaggio di chat o comando slash',
      console_send_btn: 'Invia',
      action_use_item: 'click destro',
      action_use_item_title: "Click destro / usa l'oggetto in mano (es. lancia ampolla exp, mangia, usa)",
      action_drop_item: 'Q (getta oggetto)',
      action_drop_item_title: "Getta a terra l'oggetto tenuto in mano",
      console_joining_server: 'Accesso al server in corso',
      console_loading_minecraft: 'Caricamento di Minecraft',

      // Setup Steps Navigation
      setup_step_1_title: 'Questo computer',
      setup_step_1_sub: 'Strumenti richiesti e chiave SSH',
      setup_step_2_title: 'Account Oracle',
      setup_step_2_sub: 'Accesso, regione e quota gratuita',
      setup_step_3_title: 'VM Always Free',
      setup_step_3_sub: 'E2.1.Micro e protezione archiviazione',
      setup_step_4_title: 'Installazione sicura',
      setup_step_4_sub: 'MCC leggero e servizi',
      setup_step_5_title: 'Questo account',
      setup_step_5_sub: 'Accesso Microsoft per l\'account selezionato',

      // Setup Step 1 Content
      step1_title: 'Verifica questo computer',
      step1_lead: 'Il centro di controllo necessita di alcuni strumenti standard a riga di comando. Questa verifica condivisa deve passare solo una volta, indipendentemente dal numero di account Minecraft aggiunti.',
      step1_actions_note: 'Verifica di sola lettura',
      step1_action_btn: 'Esegui verifica preliminare',

      // Setup Step 2 Content
      step2_title: 'Verifica Oracle Cloud',
      step2_lead: 'Leggi la tenancy condivisa, la regione home, le istanze attuali e l\'uso dell\'archiviazione. Questo passaggio non crea nulla e non modifica {name}.',
      step2_callout: 'Limite di costo: l\'azione di creazione rimane bloccata finché la forma (shape), la licenza dell\'immagine, il conteggio delle istanze e lo storage a blocchi non risultano conformi ad Always Free.',
      step2_actions_note: 'Nessuna risorsa Oracle viene modificata',
      step2_action_btn: 'Verifica quota gratuita',

      // Setup Step 3 Content
      step3_title_existing: 'Usa la VM esistente',
      step3_title_create: 'Crea la VM Always Free',
      step3_lead_existing: 'La VM E2.1.Micro registrata è raggiungibile. Questa stessa VM è condivisa dai tuoi account Minecraft salvati.',
      step3_lead_create: 'Esegui il provisioning di una VM x86 E2.1.Micro solo dopo aver esaminato i risultati della simulazione. Sarà condivisa dai tuoi account salvati.',
      step3_recorded_instance: 'Istanza registrata',
      step3_no_vm: 'Nessuna VM registrata',
      step3_confirm_label: 'Digita ALWAYS FREE per sbloccare il provisioning',
      step3_actions_note_existing: 'Nessuna nuova risorsa cloud richiesta',
      step3_actions_note_create: 'Crea una VM Oracle e, solo se necessario, la rete di base',
      step3_action_btn_existing: 'Installa su questa VM',
      step3_action_btn_create: 'Crea VM gratuita',

      // Setup Step 4 Content
      step4_title: 'Installa e ripristina in sicurezza',
      step4_lead: 'Applica il runtime leggero MCC, i limiti di memoria, il firewall, i log persistenti e i comandi di supporto.',
      step4_ssh_connection: 'Connessione SSH',
      step4_ready: 'Pronto',
      step4_cluster_runtime: 'Runtime del cluster',
      step4_installed_every_host: 'Installato su ogni host',
      step4_needs_repair: 'Richiede ripristino',
      step4_actions_note: 'Idempotente e sicuro da ripetere',
      step4_action_btn: 'Installa o ripristina',

      // Setup Step 5 Content
      step5_ready_title: '{name} è pronto',
      step5_ready_lead: 'La VM condivisa è configurata e questo account Minecraft ha effettuato l\'accesso. L\'avvio e l\'arresto di {name} sono gestiti separatamente da Panoramica.',
      step5_signed_in_as: 'Accesso effettuato come {name}',
      step5_ready_to_start: 'Account {slot} · pronto per l\'avvio quando preferisci',
      step5_setup_complete: 'La configurazione iniziale di questo account è completata',
      step5_signin_title: 'Accedi con {name}',
      step5_signin_lead: 'Avvia una procedura con codice dispositivo solo per questo account. Una finestra mostrerà il link ufficiale Microsoft e il codice monouso per Java o Bedrock.',
      step5_signin_callout: 'La tua password Microsoft non passa mai attraverso questo centro di controllo. Il token di aggiornamento rimane nel profilo privato di questo account sul rispettivo host Oracle.',
      step5_need_free_alt: 'Hai bisogno di un alt Bedrock?',
      step5_free_alt_desc: 'Gli account Bedrock richiedono un profilo Microsoft/Xbox e una licenza Minecraft Bedrock posseduta.',
      step5_guide_link: 'Guarda la guida in 2 minuti →',
      step5_human_action: 'Azione manuale richiesta per l\'account {slot}',
      step5_signin_btn: 'Accedi con l\'account {slot}',
      step5_signout_name: 'Disconnetti {name}',
      step5_signout_slot: 'Disconnetti account {slot}',

      // Voting View
      voting_eyebrow: 'Ricompense del server',
      voting_title: 'Votazioni',
      voting_lead: 'Vota Complex Gaming sui siti di classifica per ricevere chiavi giornaliere, claim block e ricompense. I timer si aggiornano automaticamente per ogni sito.',
      voting_notify_title: 'Attiva le notifiche del browser alla scadenza di un timer',
      voting_notify_on: 'Notifiche: Attivate',
      voting_notify_off: 'Notifiche: Disattivate',
      voting_sound_title: 'Attiva/disattiva il segnale acustico',
      voting_sound_on: 'Suono: Attivo',
      voting_sound_off: 'Suono: Disattivo',
      voting_test_btn: 'Test',
      voting_filter_both: 'Entrambi',
      voting_status_ready: '{count}/8 pronti',
      voting_mark_all: 'Segna tutti',
      voting_mark_all_title: 'Segna tutti e 8 come votati adesso',
      voting_set_time_title: 'Imposta orario per tutti (es. 06:09)',
      voting_reset_all_title: 'Reimposta tutti e 8 i timer su pronto',
      voting_site_ready: 'Pronto per votare',
      voting_site_voted: 'Votato',
      voting_site_vote_now: 'Vota ora ↗',
      voting_site_vote: 'Vota ↗',
      voting_site_in: 'tra',
      voting_custom_timer: 'Timer personalizzato',
      voting_custom_interval: 'Intervallo personalizzato',
      voting_custom_interval_title: 'Fai clic per modificare le ore del ciclo di voto',
      voting_undo: 'Annulla',
      voting_alert_msg: '{player} può votare su {site} adesso!',

      // Bedrock Account Setup Guide

      // Guide Step 1

      // Guide Step 2

      // Guide Step 3

      // Guide FAQ

      // Settings View
      settings_heading: 'Impostazioni',
      settings_lead: 'Scegli un\'area qui sotto. Le modifiche a server, versione e RAM richiedono un riavvio del client; le impostazioni per account (comando di avvio, accettazione automatica TPA, scopo) si applicano dal vivo.',
      settings_kicker_client: 'Client Minecraft',
      settings_h3_connection: 'Dettagli connessione',
      settings_connection_sub: 'Usa l\'indirizzo del server Java e la versione esatta di Minecraft supportata.',
      settings_server_label: 'Server Minecraft',
      settings_server_small: 'Usa l\'indirizzo Java diretto del server. La porta è facoltativa.',
      settings_version_label: 'Versione Minecraft',
      settings_version_small: 'La 1.12.2 consuma poca memoria, ma la versione selezionata deve supportare una connessione reale.',

      // Settings - Account Tab
      settings_kicker_account: 'Configurazione per account',
      settings_h3_account: 'Impostazioni account',
      settings_account_sub: 'Personalizza l\'automazione di avvio e il comportamento per ciascun account Minecraft connesso.',
      settings_select_account: 'Seleziona account',
      settings_assigned_vm: 'Assegnato alla VM Oracle',
      settings_kicker_alt: 'Identità alt',
      settings_h3_purpose: 'Scopo e nota',
      settings_purpose_sub: 'Assegna un ruolo o una nota a questo alt (es. Spawner, Cactus, AFK Pool).',
      settings_purpose_label: 'Scopo alt / tag ruolo',
      settings_purpose_placeholder: 'es. Spawner, Cactus, AFK Pool',
      settings_purpose_small: 'Mostrato come etichetta sulle schede account.',

      settings_kicker_startup: 'Automazione avvio',
      settings_h3_join_cmd: 'Comando all\'accesso',
      settings_join_cmd_sub: 'Esegue automaticamente un comando dopo essersi connesso e generato nel server.',
      settings_auto_run_cmd: 'Esegui comando all\'accesso',
      settings_auto_run_cmd_sub: 'Invia un comando (come /home alt) ogni volta che questo account accede al server o si riconnette.',
      settings_startup_cmd_label: 'Comando all\'accesso',
      settings_startup_cmd_small: 'Comando inviato al server (es. /home alt o /home farm).',
      settings_delay_label: 'Ritardo dopo l\'accesso',
      settings_delay_2s: '2 secondi',
      settings_delay_3s: '3 secondi',
      settings_delay_5s: '5 secondi (consigliato)',
      settings_delay_8s: '8 secondi',
      settings_delay_10s: '10 secondi',
      settings_delay_15s: '15 secondi',
      settings_delay_20s: '20 secondi',
      settings_delay_small: 'Dà al server il tempo di caricare i chunk e spawnare prima di eseguire il comando.',

      // Teleport Automation & Whitelist
      settings_kicker_tpa: 'Automazione teletrasporto',
      settings_h3_tpa: 'Accetta automaticamente le richieste di teletrasporto',
      settings_tpa_sub: 'Accetta automaticamente le richieste /tpa e /tpahere dai giocatori fidati.',
      settings_tpa_auto_accept: 'Accetta /tpa e /tpahere dalla whitelist',
      settings_tpa_auto_accept_sub: 'Esegue automaticamente /tpyes quando un giocatore nella whitelist richiede un teletrasporto in una delle due direzioni.',
      settings_whitelisted_players: 'Giocatori in whitelist',
      settings_players_count: '{count} giocator{s}',
      settings_add_player_placeholder: 'Aggiungi nome giocatore…',
      settings_add_player_btn: 'Aggiungi',
      settings_whitelist_help: 'Premi Invio o fai clic su Aggiungi per inserire. Fai clic su un campo sopra per modificarlo o su × per rimuoverlo.',
      settings_whitelist_empty_hint: 'Nessun giocatore in whitelist. Inserisci un nome utente sotto e premi Invio o fai clic su Aggiungi.',
      settings_tpa_sync_all: 'Applica la whitelist a tutti gli account',
      settings_tpa_sync_all_sub: 'Aggiorna e ricarica a caldo ogni bot con questa whitelist al salvataggio senza riavviare.',

      // Settings - Resources Tab
      settings_kicker_resources: 'Risorse client',
      settings_h3_memory: 'Limite memoria',
      settings_memory_sub: 'Questi limiti lasciano spazio a Linux, SSH e alla memoria nativa di Java sulla VM da 1 GB.',
      settings_min_heap: 'Heap minimo',
      settings_min_heap_small: 'Memoria riservata all\'avvio del client.',
      settings_max_heap: 'Heap massimo',
      settings_max_heap_small: 'Limite massimo invalicabile per il client Minecraft.',
      settings_kicker_vm: 'VM Oracle',
      settings_h3_ssh: 'Shell remota',
      settings_ssh_sub: 'Nome di accesso utilizzato dagli strumenti di installazione e ripristino sull\'host selezionato.',
      settings_ssh_user: 'Utente SSH',

      // Settings - Remote Access Tab
      settings_kicker_remote: 'Altri dispositivi',
      settings_h3_public_link: 'Link di controllo pubblico',
      settings_public_link_sub: 'Accesso HTTPS protetto da password da un altro computer o dal tuo smartphone.',
      settings_public_url: 'URL pubblico',
      settings_open_remote: 'Apri controllo remoto ↗',
      settings_url_temporary: 'Indirizzo temporaneo; può cambiare se il tunnel si riavvia.',
      settings_url_stable: 'Indirizzo stabile',
      settings_kicker_security: 'Sicurezza',
      settings_h3_password: 'Password di controllo',
      settings_password_sub: 'Imposta la password utilizzata da questa pagina di controllo pubblico.',
      settings_new_password: 'Nuova password',
      settings_password_min_chars: 'Usa almeno 12 caratteri.',
      settings_confirm_password: 'Conferma password',
      settings_password_msg_default: 'Le sessioni attualmente connesse rimangono attive.',
      settings_change_password_btn: 'Cambia password',
      settings_remote_unavailable_title: 'L\'accesso remoto non è configurato',
      settings_remote_unavailable_desc: 'Completa l\'installazione sicura in Configurazione account per creare un link di controllo pubblico.',
      settings_save_msg: 'Le modifiche per account si applicano dal vivo; server/versione/RAM richiedono un riavvio.',
      settings_save_btn: 'Salva',
      settings_saving_btn: 'Salvataggio…',
      settings_saved_btn: 'Salvato ✓',

      // Auth Modal
      auth_eyebrow: 'Accesso sicuro dispositivo',
      auth_title: 'Connetti un account Microsoft',
      auth_connect_name: 'Connetti {name}',
      auth_close_label: 'Chiudi finestra di accesso',
      auth_lead: 'Scegli Java, Bedrock, o entrambi per lo stesso account Microsoft:',
      auth_card_java_badge: 'PC Standard',
      auth_card_java_title: 'Java Edition',
      auth_card_java_desc: 'Account PC standard e alt Java',
      auth_card_bedrock_badge: 'Xbox / Mobile',
      auth_card_bedrock_title: 'Bedrock Edition',
      auth_card_bedrock_desc: 'Console, Xbox o nomi con prefisso punto (es. .nomeutente)',
      auth_card_both_badge: 'Stesso account Microsoft',
      auth_card_both_title: 'Java + Bedrock',
      auth_card_both_desc: 'Verifica Java, poi aggiunge Bedrock. Se Java è già salvato, viene riutilizzato senza rimuovere nulla.',
      auth_hint_q: 'Quale dovrei scegliere?',
      auth_hint_text: 'Usa Java + Bedrock per entrambe le identità dello stesso account Microsoft. Se Java è già salvato, viene aggiunta solo la nuova identità Bedrock.',
      auth_hint_link: 'Come impostare Bedrock →',
      auth_connecting_bedrock: 'Connessione Bedrock Edition (.alt)',
      auth_connecting_java: 'Connessione Java Edition (PC)',
      auth_connecting_both: 'Verifica Java, poi Bedrock',
      auth_both_step1: 'Passo 1 di 2: Verifica Java Edition',
      auth_both_step2: 'Passo 2 di 2: Aggiunta Bedrock Edition',
      auth_both_step2_status: 'Java verificato! Inserisci questo secondo codice su Microsoft per collegare Bedrock.',
      auth_switch_edition: '← Cambia edizione',
      auth_step1_title: 'Scegli l\'account Microsoft',
      auth_step1_sub: 'Microsoft chiede quale account usare prima del codice.',
      auth_step2_title: 'Conferma il codice',
      auth_step2_sub: 'Incolla il codice sotto se Microsoft lo richiede ancora.',
      auth_open_microsoft: 'Apri accesso Microsoft',
      auth_link_preparing: 'Preparazione della pagina di accesso in corso…',
      auth_link_failed: 'Accesso non completato',
      auth_code_label: 'Codice monouso',
      auth_code_preparing: 'Preparazione…',
      auth_code_see_ms: 'Vedi Microsoft',
      auth_copy_btn: 'Copia',
      auth_copied_btn: 'Copiato',
      auth_status_starting: 'Avvio di una sessione di accesso sicuro in corso…',
      auth_status_ready: 'Pronto. Apri Microsoft, scegli l\'account, poi conferma il codice.',
      auth_status_waiting_code: 'La pagina Microsoft è pronta. In attesa del codice monouso…',
      auth_status_approving: 'Microsoft ha confermato! Convalida del profilo in corso…',
      auth_status_preparing_bedrock: 'Java verificato! Preparazione del codice Bedrock in corso…',
      auth_status_failed: 'Microsoft non ha confermato l\'accesso. Riprova per un nuovo codice.',
      auth_retry_hint: 'Richiedi un nuovo codice Microsoft. Il tentativo precedente è stato interrotto.',
      auth_retry_btn: 'Riprova',
      auth_foot: 'Puoi chiudere questa finestra di dialogo mentre l\'accesso continua. Rileveremo l\'approvazione automaticamente.',
      auth_switch_java_not_found: 'Nessun profilo Java trovato per questo account Microsoft. Volevi accedere come Bedrock?',
      auth_switch_java_btn: 'Passa a Bedrock e riprova',
      auth_switch_bedrock_not_found: 'Profilo Bedrock non trovato. Volevi accedere come Java?',
      auth_switch_bedrock_btn: 'Passa a Java e riprova',
      auth_bedrock_no_license: 'Mojang ha rifiutato il multigiocatore Bedrock per questo account Microsoft. Se possiedi Java, Bedrock è incluso, ma devi avviare Minecraft Bedrock almeno una volta su questo account prima di connetterti.',
      auth_view_guide_btn: 'Come impostare Bedrock →',
      auth_view_help_btn: 'Come impostare Bedrock →',

      // Bedrock Account Setup Helper
      bedrock_help_eyebrow: 'Setup Account Bedrock',
      bedrock_help_title: 'Come configurare Bedrock',
      bedrock_help_java_title: 'Hai già un account Microsoft con Java?',
      bedrock_help_java_desc: 'Ogni account Microsoft che possiede Minecraft Java Edition include gratuitamente anche Bedrock Edition per PC (fa parte del bundle ufficiale Minecraft).',
      bedrock_help_launch_warn: 'Requisito fondamentale: Devi avviare Minecraft Bedrock almeno una volta su questo account Microsoft (tramite il Minecraft Launcher su PC, console o mobile) prima che ALT Pilot possa autenticarsi. L\'avvio del gioco inizializza la tua identità Xbox e la licenza multiplayer Bedrock con Mojang. Senza questo avvio, l\'accesso fallirà con UNAUTHORIZED.',
      bedrock_help_alt_title: 'Vuoi creare un alt Bedrock separato?',
      bedrock_help_alt_step1: 'Crea un account Microsoft gratuito con anno di nascita 18+ (necessario per sbloccare il multiplayer online).',
      bedrock_help_alt_step2: 'Scegli il tuo Gamertag Xbox su xbox.com (o nel Minecraft Launcher).',
      bedrock_help_alt_step3: 'Avvia Minecraft Bedrock almeno una volta con quel profilo per attivarlo.',
      bedrock_help_connect_title: 'Connessione in ALT Pilot',
      bedrock_help_connect_desc: 'Scegli "Java + Bedrock" per collegare entrambe le identità dallo stesso account Microsoft (Java resta salvato e Bedrock viene aggiunto come compagno). Oppure scegli "Bedrock Edition" per un account alt dedicato. Gli alt Bedrock entrano nei server Floodgate (come Complex Skyblock) con un punto iniziale (es. .Username).',
      bedrock_help_close: 'Ho capito',
      bedrock_help_cta: 'Apri configurazione account',

      // Pre-Start Modal
      pre_start_eyebrow: 'Avviso prima dell\'avvio',
      pre_start_title: 'Un\'altra sessione potrebbe essere attiva',
      pre_start_close_label: 'Chiudi avviso',
      pre_start_intro: 'L\'avvio di {name} può influire su un\'altra sessione attiva di Minecraft.',
      pre_start_foot: 'Se hai la certezza che nessuno stia attualmente giocando su quell\'account, fai clic su Avvia comunque. Altrimenti, chiudi questa finestra e arresta prima l\'altra sessione.',
      pre_start_cancel: 'Annulla',
      pre_start_confirm: 'Avvia comunque',

      // Task Drawer
      task_working: 'Elaborazione in corso…',
      task_starting: 'Avvio in corso…',
      task_sending_req: 'Invio della richiesta alla VM in corso…',
      task_done: 'Fatto',
      task_failed: 'Azione non riuscita',
      task_accepted: 'Avvio accettato — il caricamento continua',
      task_start_name: 'Avvio di {name}',
      task_restart_name: 'Riavvio di {name}',
      task_stop_name: 'Arresto di {name}',
      task_signout_name: 'Disconnessione di {name}',
      task_save_account: 'Salvataggio impostazioni per {name}',
      task_save_client: 'Salvataggio impostazioni client',

      // Dialogs & Confirmations
      confirm_disconnect_name: 'Disconnettere {name}? La VM Oracle rimarrà attiva.',
      confirm_start_all: 'Avviare tutti gli account Minecraft connessi negli host Oracle?',
      confirm_stop_all: 'Disconnettere tutti gli account Minecraft? Entrambi gli host Oracle rimarranno attivi.',
      confirm_signout_name: 'Rimuovere {name}? Il client verrà fermato e la sessione Microsoft salvata verrà eliminata. Per aggiungerlo di nuovo dovrai accedere.',

      // Alerts & Errors
      alert_wait_task: 'Attendi che l\'azione corrente termini prima di avviare un altro accesso.',
      alert_headsup_failed: 'Controllo preliminare non riuscito: {error}. Avvio comunque.',
      alert_enter_chat_cmd: 'Inserisci un messaggio di chat o un comando slash.',
      alert_password_length: 'Usa almeno 12 caratteri per la password di controllo.',
      alert_password_mismatch: 'La conferma della password non corrisponde.',
      alert_notifications_unsupported: 'Le notifiche desktop non sono supportate in questo browser.',
      alert_password_changed: 'Password modificata con successo.',
      alert_settings_saved: 'Impostazioni salvate.',
      alert_username_format: 'Il nome utente del giocatore deve essere di 1–16 caratteri (lettere, numeri, trattini bassi).',
      alert_already_whitelisted: '{name} è già nella whitelist.',
      alert_files_out_of_sync: 'I file del pannello di controllo non sono sincronizzati. Ricarica la pagina prima di avviare questo account.',

      // Additional Hero, Controls, Scope & Modals
      ctrl_stop_client: 'Arresta client',
      ctrl_start_client: 'Avvia client',
      status_pill_not_connected: 'Non connesso',
      hero_title_stopped: 'Client arrestato',
      hero_desc_stopped: 'Avvialo una volta completata la configurazione e l\'accesso.',
      status_pill_vm_unavailable: 'VM non disponibile',
      hero_title_vm_unavailable: 'Impossibile raggiungere la VM',
      hero_desc_vm_unavailable: 'Verifica lo stato della VM e la connessione SSH nella configurazione guidata.',
      status_pill_connected: 'Connesso',
      hero_title_online: 'Il tuo alt è online',
      hero_desc_online: 'Il client headless ha una connessione Minecraft attiva verso {server}.',
      status_pill_connection_dropped: 'Connessione interrotta',
      hero_title_dropped: 'Il client ha raggiunto il server, poi si è disconnesso',
      hero_desc_dropped: 'Il watchdog di connessione sta confermando la disconnessione e riavvierà automaticamente questo account.',
      status_pill_starting: 'Avvio in corso',
      hero_title_starting: 'Avvio del client',
      hero_desc_starting: 'L\'attività di avvio in tempo reale appare di seguito.',
      hero_desc_sending_req: 'Invio della richiesta alla VM in corso…',
      status_pill_retrying: 'Nuovo tentativo',
      hero_title_retrying: 'Il client sta ritentando l\'avvio',
      hero_desc_retrying: 'Un avvio precedente è terminato prima del previsto. Il servizio ritenterà automaticamente e questa pagina continuerà ad aggiornarsi.',
      status_pill_start_failed: 'Avvio non riuscito',
      hero_title_failed: 'Impossibile avviare il client',
      hero_desc_failed: 'Il servizio si è arrestato con codice di uscita {status}. Usa Riavvia per riprovare.',
      status_pill_setup_needed: 'Configurazione necessaria',
      hero_title_setup_needed: 'La VM richiede l\'installazione sicura',
      hero_desc_setup_needed: 'Continua la configurazione guidata per installare e configurare il client.',
      status_pill_signin_needed: 'Accesso necessario',
      hero_title_signin_needed: 'Minecraft richiede l\'autorizzazione',
      hero_desc_signin_needed: 'Usa la procedura device-code di Microsoft. La tua password non entra mai in questa app.',
      conn_detail_connected: 'Connesso a Minecraft e pronto per i comandi della console.',
      conn_detail_active: 'Il client è attivo; lo stato della connessione si aggiorna automaticamente.',
      conn_detail_controls: 'I controlli di avvio e riavvio si trovano nell\'angolo in alto a destra.',
      setup_scope_hint: 'I passaggi 1–4 preparano la VM Oracle condivisa. Il passaggio 5 connette solo {name}.',
      wizard_scope_shared: 'Passaggio VM condiviso · si applica a ogni account salvato',
      wizard_scope_account: 'Solo questo account · {name}',
      step2_cost_boundary: '<strong>Limite di costo:</strong> l\'azione Crea rimane bloccata finché la forma, la licenza dell\'immagine, il conteggio delle istanze e lo storage a blocchi totale non risultano entro il piano Always Free.',
      step3_type_confirm: 'Digita ALWAYS FREE per sbloccare il provisioning',
      voting_notify_blocked: 'Notifiche: Bloccate',
      pre_start_title_restart: 'Il riavvio potrebbe disturbare un\'altra sessione',
      pre_start_confirm_restart: 'Riavvia comunque',

      // Calculator view
      calc_eyebrow: 'Strumenti di trading',
      calc_title: 'Calcolatore profitto IGM ↔ GC',
      calc_lead: 'Inserisci quanto paghi e quanto ricevi. Il profitto è mostrato per stack da 64.',
      calc_rate_title: 'Tasso attuale',
      calc_rate_lead: 'Quanti IGM vale 1 GC adesso. Salvato in locale su questo dispositivo.',
      calc_rate_label: 'IGM per 1 GC',
      calc_rate_hint: 'Aggiorna quando il mercato si muove — anche ogni minuto.',
      calc_rate_saved: 'Salvato',
      calc_buy_title: 'Compri',
      calc_sell_title: 'Vendi',
      calc_qty_label: 'Quantità',
      calc_fee_label: 'Fee AH',
      calc_unit_custom: 'Custom',
      calc_for_n: 'per',
      calc_miss_rate: 'tasso',
      calc_miss_qty: 'quantità',
      calc_miss_buy: 'prezzo acquisto',
      calc_miss_sell: 'prezzo vendita',
      calc_enter_prefix: 'Inserisci',
      calc_enter_suffix: 'per vedere il profitto.',
      calc_fee_weekday: 'Feriale',
      calc_fee_sunday: 'Domenica',
      calc_buy_per_item: 'Costo per item',
      calc_sell_per_item: 'Ricavo per item (lordo)',
      calc_total_cost: 'Costo totale',
      calc_total_revenue: 'Ricavo totale (lordo)',
      calc_net_revenue: 'Ricavo netto',
      calc_profit_yes: 'In profitto',
      calc_profit_no: 'In perdita',
      calc_profit_zero: 'In pareggio',
      calc_per_item_profit: 'Profitto per item',
      calc_stack_profit: 'Profitto dello stack',
      calc_per_item: 'per item',
      calc_preset_2m: '2.000.000',
      calc_preset_3m: '3.000.000',
      calc_preset_5m: '5.000.000',
      calc_preset_hint: 'Preset rapidi',
      calc_item_presets: 'Preset oggetti',
      calc_preset_save: '+ Salva attuale',
      calc_preset_name_prompt: 'Nome per questo preset (es. Votekeys)',
      calc_preset_icon_prompt: 'Icona: incolla URL immagine, o una emoji (vuoto per default)',
      calc_preset_delete: 'Elimina preset',
      calc_net_profit: 'Profitto netto · stack da 64',
      calc_preset_dialog_title: 'Salva preset',
      calc_preset_dialog_name: 'Nome',
      calc_preset_dialog_icon: 'Sprite oggetto',
      calc_preset_dialog_cancel: 'Annulla',
      calc_preset_dialog_save: 'Salva',
      calc_sprite_search: 'Cerca oggetti…',
      calc_sprite_empty: 'Nessun oggetto trovato',
      calc_sprite_loading: 'Caricamento oggetti…',
      calc_sprite_selected: 'Selezionato',
      calc_sprite_more: 'altri — digita per filtrare',
    }
  };

  const listeners = [];
  const SUPPORTED_LANGS = ['en', 'it'];

  function primaryLang(tag) {
    return String(tag || '').toLowerCase().replace('_', '-').split('-')[0];
  }

  // First supported tag in the browser language list wins (it-IT, it-CH, …).
  // An explicit localStorage choice always takes precedence. Geolocation is
  // not used: language is a browser preference, not a country.
  function detectBrowserLang(nav) {
    const source = nav || (typeof navigator !== 'undefined' ? navigator : null);
    if (!source) return 'en';
    const tags = [];
    if (Array.isArray(source.languages)) tags.push(...source.languages);
    if (source.language) tags.push(source.language);
    for (const tag of tags) {
      const primary = primaryLang(tag);
      if (SUPPORTED_LANGS.includes(primary)) return primary;
    }
    return 'en';
  }

  function getStoredLang() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (SUPPORTED_LANGS.includes(stored)) return stored;
    } catch (_) {}
    return detectBrowserLang();
  }

  let currentLang = getStoredLang();

  function t(key, params = {}) {
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    let text = dict[key] ?? TRANSLATIONS.en[key] ?? key;
    if (typeof text === 'string' && params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v ?? ''));
      }
    }
    return text;
  }

  function applyTranslations(root = document) {
    if (!root || !root.querySelectorAll) return;

    // Update root document lang
    if (document.documentElement) {
      document.documentElement.lang = currentLang;
    }

    // Update data-i18n text
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (!key) return;
      const translated = t(key);
      if (translated !== key) {
        el.textContent = translated;
      }
    });

    // Update placeholders
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      if (!key) return;
      const translated = t(key);
      if (translated !== key) {
        el.placeholder = translated;
      }
    });

    // Update titles
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.dataset.i18nTitle;
      if (!key) return;
      const translated = t(key);
      if (translated !== key) {
        el.title = translated;
      }
    });

    // Update aria-labels
    root.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const key = el.dataset.i18nAria;
      if (!key) return;
      const translated = t(key);
      if (translated !== key) {
        el.setAttribute('aria-label', translated);
      }
    });

    // Update language switcher active state
    root.querySelectorAll('.lang-btn').forEach(btn => {
      const isActive = btn.dataset.lang === currentLang;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }

  function setLang(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) return;
    currentLang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {}
    applyTranslations(document);
    listeners.forEach(cb => {
      try { cb(currentLang); } catch (e) { console.error('i18n listener error:', e); }
    });
  }

  function onLangChange(callback) {
    if (typeof callback === 'function') {
      listeners.push(callback);
    }
  }

  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = currentLang;
    applyTranslations(document);
  }

  return {
    t,
    getLang: () => currentLang,
    setLang,
    applyTranslations,
    onLangChange,
    detectBrowserLang,
    translations: TRANSLATIONS
  };
});
