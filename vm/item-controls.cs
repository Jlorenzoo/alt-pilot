//MCCScript 1.0
MCC.LoadBot(new AltPilotItemControls());
//MCCScript Extensions
public class AltPilotItemControls : ChatBot
{
    private DateTime lastAction = DateTime.MinValue;
    private readonly Dictionary<string, DateTime> commandTimes = new Dictionary<string, DateTime>();
    private bool pending = false;
    private string pendingAction = "";
    private DateTime pendingSince;
    private bool holdSent = false;
    private bool useAfterHold = false;
    private string xpSender = null;
    private int holdDestination = -1;
    private int holdSource = -1;
    private MinecraftClient.Inventory.Item holdBottle, holdPrevious;
    private int xpLevel = -1;
    private float xpProgress = -1;
    private readonly Dictionary<string, string> scoreLines = new Dictionary<string, string>();
    public override void Initialize()
    {
        foreach (var bot in GetLoadedChatBots().ToArray())
            if (!Object.ReferenceEquals(bot, this) && bot.GetType().Name == GetType().Name) UnLoadBot(bot);
        RegisterChatBotCommand("altitem", "ALT Pilot held-item action", "altitem use xp|use|drop|hold xp", LocalAction);
        LogToConsole("[ALT-PILOT] Whitelist chat controls ready: use xp, item hold xp, item use, item drop, xp?, help, whitelist add/remove, restart.");
    }
    private string Clean(string value) { return Regex.Replace(value ?? "", @"§(?:#[0-9a-fA-F]{6}|.)", ""); }
    private string Canon(string value) { return value.ToLowerInvariant().TrimStart('.'); }
    private bool Valid(string value) { return Regex.IsMatch(value ?? "", @"^\.?[A-Za-z0-9_]{1,32}$"); }
    private bool Allowed(string sender)
    {
        try { return Regex.Split(File.ReadAllText("item-command-whitelist.txt"), @"[\s,]+").Any(n => Valid(n) && Canon(n) == Canon(sender)); }
        catch { return false; }
    }
    private bool Parse(string raw, out string sender, out string command)
    {
        sender = command = "";
        if (Regex.IsMatch(raw ?? "", @"[\x00-\x1f\x7f-\x9f]")) return false;
        string text = Clean(raw).Trim();
        if (text.Length > 2048 || text.Contains("\n") || text.Contains("\r") || text.Contains("\0")) return false;
        string name = @"(\.?[A-Za-z0-9_]{1,32})\*?";
        string cmd = @"(use xp|item use xp|item use|item drop|item hold xp|xp\?|xp|help|restart|whitelist (?:add|remove) \.?[A-Za-z0-9_]{1,32})";
        string bang = @"!/?[A-Za-z0-9_][A-Za-z0-9_:.-]{0,63}(?: +[^\x00-\x1f\x7f-\x9f]+)?";
        string privateCmd = cmd.Substring(0, cmd.Length - 1) + "|" + bang + ")";
        string ranks = @"(?:\[[^\]\r\n]{1,100}\]\s*)*";
        string arrow = @"(?:->|→|»|➜|➤|⇒)";
        string[] patterns = {
            @"^[▌\s]*(?:Hub \d+\s+)?" + ranks + name + @"\s*:\s*" + cmd + @"\s*$",
            @"^<" + name + @">\s*" + cmd + @"\s*$",
            @"^[▌\s]*" + ranks + name + @"\s+whispers?(?:\s+to\s+you)?\s*:\s*" + privateCmd + @"\s*$",
            @"^[▌\s]*" + ranks + @"\[\s*" + name + @"\s*" + arrow + @"\s*" + ranks + @"(me|\.?[A-Za-z0-9_]{1,32})\s*\]\s*:?\s*" + privateCmd + @"\s*$",
            @"^[▌\s]*(?:From|Message from)\s+" + ranks + name + @"\s*:\s*" + privateCmd + @"\s*$",
            @"^[▌\s]*(?:(?:Skyblock|Hub(?: \d+)?|Lobby)\s+)?" + ranks + name + @"\s+" + arrow + @"\s+" + ranks + @"(You|me|\.?[A-Za-z0-9_]{1,32})\s*:?\s*" + privateCmd + @"\s*$"
        };
        for (int i = 0; i < patterns.Length; i++) {
            var m = Regex.Match(text, patterns[i], RegexOptions.IgnoreCase);
            if (!m.Success) continue;
            bool recipient = i == 3 || i == 5;
            if (recipient && m.Groups[2].Value.ToLowerInvariant() != "me" && m.Groups[2].Value.ToLowerInvariant() != "you" && Canon(m.Groups[2].Value) != Canon(GetUsername())) continue;
            sender = m.Groups[1].Value; command = m.Groups[recipient ? 3 : 2].Value;
            if (command.StartsWith("!")) {
                if (command.Length > 100) return false;
                command = "/" + command.Substring(1).TrimStart('/');
            }
            return Canon(sender) != Canon(GetUsername());
        }
        return false;
    }
    public override void GetText(string text)
    {
        string sender, command;
        if (!Parse(text, out sender, out command) || !Allowed(sender)) return;
        DateTime previous;
        string key = Canon(sender);
        if (commandTimes.TryGetValue(key, out previous) && (DateTime.UtcNow - previous).TotalSeconds < 1) return;
        commandTimes[key] = DateTime.UtcNow;
        foreach (var old in commandTimes.Where(x => (DateTime.UtcNow - x.Value).TotalMinutes > 1).Select(x => x.Key).ToArray()) commandTimes.Remove(old);
        if (command.StartsWith("/")) {
            SendText(command);
            Reply(sender, "Command sent to the server.");
            return;
        }
        if (command.Equals("use xp", StringComparison.OrdinalIgnoreCase) || command.Equals("item use xp", StringComparison.OrdinalIgnoreCase)) { Reply(sender, HoldXP(true, sender).Replace("[ALT-PILOT] ", "")); return; }
        if (command.Equals("item hold xp", StringComparison.OrdinalIgnoreCase)) { Reply(sender, HoldXP().Replace("[ALT-PILOT] ", "")); return; }
        if (command.Equals("item use", StringComparison.OrdinalIgnoreCase)) { Reply(sender, Action("use").Replace("[ALT-PILOT] ", "")); return; }
        if (command.Equals("item drop", StringComparison.OrdinalIgnoreCase)) { Reply(sender, Action("drop").Replace("[ALT-PILOT] ", "")); return; }
        if (command.Equals("help", StringComparison.OrdinalIgnoreCase)) {
            string helpKey = key + "/help";
            if (commandTimes.TryGetValue(helpKey, out previous) && (DateTime.UtcNow - previous).TotalSeconds < 5) return;
            commandTimes[helpKey] = DateTime.UtcNow;
            // MCC's send queue spaces these messages using MessageCooldown.
            Reply(sender, "[Help 1/4] Items: use xp | item use | item drop");
            Reply(sender, "[Help 2/4] xp? | help | PM !command args");
            Reply(sender, "[Help 3/4] Access: whitelist add/remove NAME");
            Reply(sender, "[Help 4/4] Client: restart (this alt only)");
        } else if (command.Equals("xp?", StringComparison.OrdinalIgnoreCase) || command.Equals("xp", StringComparison.OrdinalIgnoreCase)) Reply(sender, XP());
        else {
            string[] parts = command.Split(' ');
            string operation = command.Equals("restart", StringComparison.OrdinalIgnoreCase) ? "restart" : parts[1].ToLowerInvariant();
            string target = operation == "restart" ? "" : parts[2];
            try {
                string dir = Path.GetFullPath("../chat-requests");
                Directory.CreateDirectory(dir);
                if (Directory.GetFiles(dir, "*.json").Length >= 20) { Reply(sender, "Command queue is full. Please try again later."); return; }
                string file = Path.Combine(dir, Guid.NewGuid().ToString("N") + ".json");
                string json = "{\"sender\":\"" + sender + "\",\"operation\":\"" + operation + "\",\"target\":\"" + target + "\",\"created\":" + DateTimeOffset.UtcNow.ToUnixTimeSeconds() + "}";
                File.WriteAllText(file + ".tmp", json); File.Move(file + ".tmp", file);
                LogToConsole("[ALT-PILOT] Queued " + operation + " request from " + sender + ".");
                Reply(sender, "Request queued; waiting for the control service.");
            } catch (Exception error) {
                LogToConsole("[ALT-PILOT] Could not queue chat command: " + error.GetType().Name);
                Reply(sender, "Could not queue the command. Please try again later.");
            }
        }
    }
    private void Reply(string sender, string message)
    {
        int limit = 100 - ("/msg " + sender + " ").Length;
        string line = "";
        foreach (string word in message.Split(' ')) {
            if (line.Length + word.Length > limit) { SendPrivateMessage(sender, line.Trim()); line = ""; }
            line += word + " ";
        }
        if (line.Length > 0) SendPrivateMessage(sender, line.Trim());
    }
    private string LocalAction(string command, string[] args)
    {
        if (args.Length >= 1)
        {
            string arg = args[0].ToLowerInvariant();
            if (args.Length == 2 && arg == "use" && args[1].Equals("xp", StringComparison.OrdinalIgnoreCase)) return HoldXP(true);
            if (args.Length == 2 && arg == "hold" && args[1].Equals("xp", StringComparison.OrdinalIgnoreCase)) return HoldXP();
            if (arg == "use" || arg == "drop") return Action(arg);
            if (arg == "xp" || arg == "xp?") {
                string xp = XP();
                LogToConsole("[ALT-PILOT] " + xp);
                return "[ALT-PILOT] " + xp;
            }
            if (arg == "help") {
                LogToConsole("[ALT-PILOT] [Help 1/4] Items: use xp | item use | item drop");
                LogToConsole("[ALT-PILOT] [Help 2/4] xp? | help | PM !command args");
                LogToConsole("[ALT-PILOT] [Help 3/4] Access: whitelist add/remove NAME");
                LogToConsole("[ALT-PILOT] [Help 4/4] Client: restart (this alt only)");
                return "[ALT-PILOT] Displayed help.";
            }
        }
        return "Usage: altitem use xp|use|drop|hold xp|xp|help";
    }
    private bool IsBottle(MinecraftClient.Inventory.Item item)
    {
        return item != null && item.Count > 0 && item.Type.ToString() == "ExperienceBottle";
    }
    private string HoldXP(bool useAfter = false, string sender = null)
    {
        if ((DateTime.UtcNow - lastAction).TotalSeconds < 2) return "[ALT-PILOT] Wait 2 seconds between item actions.";
        if (pending) return "[ALT-PILOT] Waiting for a server inventory update; no retry was sent.";
        if (!GetInventoryEnabled()) return "[ALT-PILOT] Inventory tracking is unavailable.";
        if (GetInventories().Keys.Any(id => id != 0)) return "[ALT-PILOT] Close the open inventory first.";
        var inventory = GetPlayerInventory();
        if (inventory.Items.ContainsKey(-1) && inventory.Items[-1] != null && !inventory.Items[-1].IsEmpty)
            return "[ALT-PILOT] Clear the inventory cursor first; no move was sent.";
        var sources = inventory.Items.Where(pair => pair.Key >= 9 && pair.Key <= 44 && IsBottle(pair.Value))
            .OrderBy(pair => pair.Key >= 36 ? 0 : 1).ThenBy(pair => pair.Key).ToArray();
        if (sources.Length == 0) return "[ALT-PILOT] No XP bottle found in the inventory.";
        int source = sources[0].Key;
        lastAction = DateTime.UtcNow;
        if (source >= 36) {
            if (!ChangeSlot((short)(source - 36))) return "[ALT-PILOT] Could not select the XP bottle.";
            return useAfter ? Action("use", true) : "[ALT-PILOT] Selected the XP bottle in the hotbar.";
        }
        useAfterHold = useAfter; xpSender = sender;
        int destination = Enumerable.Range(36, 9).FirstOrDefault(slot => !inventory.Items.ContainsKey(slot) || inventory.Items[slot] == null || inventory.Items[slot].IsEmpty);
        if (destination == 0) destination = 36 + GetCurrentSlot();
        holdSource = source; holdDestination = destination; holdBottle = sources[0].Value;
        inventory.Items.TryGetValue(destination, out holdPrevious);
        holdSent = false;
        pending = true; pendingAction = "hold"; pendingSince = DateTime.UtcNow;
        // Use MCC's normal inventory helper so NBT/components are preserved.
        // No outside-inventory clicks or drops, even with a completely full inventory.
        var helper = GetItemMovingHelper(inventory);
        bool sent = holdPrevious == null || holdPrevious.IsEmpty ? helper.MoveTo(source, destination) : helper.Swap(source, destination);
        if (!sent) { useAfterHold = false; return "[ALT-PILOT] XP bottle move could not be confirmed. Waiting for fresh inventory; no retry was sent."; }
        holdSent = true;
        // Java acknowledges a correctly predicted click by sending no correction.
        // Select now; the item cooldown gives corrections time to arrive before use.
        return ChangeSlot((short)(destination - 36))
            ? "[ALT-PILOT] XP bottle move requested; selected its hotbar slot."
            : "[ALT-PILOT] XP bottle move requested, but could not select its hotbar slot.";
    }
    private bool SameStack(MinecraftClient.Inventory.Item actual, MinecraftClient.Inventory.Item expected)
    {
        if (expected == null || expected.IsEmpty) return actual == null || actual.IsEmpty;
        return actual != null && actual.Type == expected.Type && actual.Count == expected.Count && actual.Data == expected.Data;
    }
    private string Action(string action, bool chained = false)
    {
        if (!chained && (DateTime.UtcNow - lastAction).TotalSeconds < 2) return "[ALT-PILOT] Wait 2 seconds between item actions.";
        if (pending) return "[ALT-PILOT] Waiting for a server inventory update; no retry was sent.";
        if (!GetInventoryEnabled()) return "[ALT-PILOT] Inventory tracking is unavailable.";
        if (GetInventories().Keys.Any(id => id != 0)) return "[ALT-PILOT] Close the open inventory first.";
        var inventory = GetPlayerInventory();
        int slot = 36 + GetCurrentSlot();
        if (!inventory.Items.ContainsKey(slot) || inventory.Items[slot] == null || inventory.Items[slot].Count < 1)
            return "[ALT-PILOT] The held slot is empty or unknown; no packet was sent.";
        lastAction = DateTime.UtcNow;
        pending = true; pendingAction = action; pendingSince = DateTime.UtcNow;
        bool sent = action == "drop" ? Handler.DropSelectedItem(false) : UseItemInHand();
        if (!sent) { pending = false; return "[ALT-PILOT] Could not send item action."; }
        LogToConsole("[ALT-PILOT] " + (action == "drop" ? "One-item drop" : "Use-item") + " request sent for held slot " + slot + ".");
        return "[ALT-PILOT] Item action sent.";
    }
    public override void OnInventoryUpdate(int inventoryId)
    {
        if (inventoryId != 0 || !pending) return;
        if (pendingAction != "hold") { pending = false; return; }
        var items = GetPlayerInventory().Items;
        MinecraftClient.Inventory.Item source, destination, cursor;
        items.TryGetValue(holdSource, out source); items.TryGetValue(holdDestination, out destination); items.TryGetValue(-1, out cursor);
        if (cursor != null && !cursor.IsEmpty) return;
        if (SameStack(source, holdBottle) && SameStack(destination, holdPrevious)) {
            pending = false;
            FinishXP(false);
            LogToConsole("[ALT-PILOT] Server inventory did not apply the XP bottle move. You can retry.");
            return;
        }
        if (!SameStack(destination, holdBottle) || !SameStack(source, holdPrevious)) return;
        pending = false;
        FinishXP(true);
    }
    private void FinishXP(bool confirmed)
    {
        bool use = useAfterHold; string sender = xpSender;
        useAfterHold = false; xpSender = null;
        bool selected = confirmed && ChangeSlot((short)(holdDestination - 36));
        if (!use) return;
        string result = sender != null && !Allowed(sender) ? "[ALT-PILOT] XP use cancelled: whitelist access changed."
            : selected ? Action("use", true) : "[ALT-PILOT] XP move failed; no use was sent.";
        LogToConsole(result);
        if (sender != null) Reply(sender, result.Replace("[ALT-PILOT] ", ""));
    }
    private void ResetSession()
    {
        useAfterHold = false; xpSender = null;
        pending = false; pendingAction = ""; holdDestination = holdSource = -1; holdBottle = holdPrevious = null; holdSent = false;
        xpLevel = -1; xpProgress = -1; scoreLines.Clear(); commandTimes.Clear();
        lastAction = DateTime.UtcNow;
    }
    public override void OnRespawn() { ResetSession(); }
    public override bool OnDisconnect(DisconnectReason reason, string message) { ResetSession(); return false; }
    public override void Update()
    {
        // Java right-click only transmits the hand, not a fabricated item stack.
        // Non-consuming interactions need not produce an inventory update.
        if (pending && pendingAction == "use" && (DateTime.UtcNow - pendingSince).TotalSeconds >= 2) pending = false;
        if (pending && pendingAction == "hold" && holdSent && (DateTime.UtcNow - pendingSince).TotalSeconds >= 2) {
            var items = GetPlayerInventory().Items;
            MinecraftClient.Inventory.Item source, destination, cursor;
            items.TryGetValue(holdSource, out source); items.TryGetValue(holdDestination, out destination); items.TryGetValue(-1, out cursor);
            if (SameStack(destination, holdBottle) && SameStack(source, holdPrevious) && (cursor == null || cursor.IsEmpty)) {
                pending = false;
                LogToConsole("[ALT-PILOT] XP bottle selected; no inventory correction received.");
                FinishXP(true);
            }
        }
        if (pending && (DateTime.UtcNow - pendingSince).TotalSeconds > 5) {
            FinishXP(false);
            LogToConsole("[ALT-PILOT] Item action remains unconfirmed; awaiting inventory refresh.");
            pendingSince = DateTime.UtcNow.AddYears(1);
        }
    }
    public override void OnSetExperience(float bar, int level, int total) { xpLevel = level; xpProgress = bar; }
    public override void OnUpdateScore(string entity, int action, string objective, string display, int value, int format)
    {
        string key = objective + "\n" + entity;
        if (action == 1) scoreLines.Remove(key); else scoreLines[key] = entity;
    }
    public override void OnScoreboardObjective(string objective, byte mode, string value, int type, string json, int format)
    {
        if (mode == 1) foreach (var key in scoreLines.Keys.Where(k => k.StartsWith(objective + "\n")).ToArray()) scoreLines.Remove(key);
    }
    private string Sidebar(string text)
    {
        var m = Regex.Match(Clean(text), @"^\s*[^A-Za-z0-9]*Experience\s*:\s*([0-9][0-9.,]*(?:\s*[KMBT])?)\s*$", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups[1].Value.Replace(" ", "").ToUpperInvariant() + " XP" : null;
    }
    private string XP()
    {
        foreach (var team in Handler.GetTeams().Values) foreach (var member in team.Members) {
            string value = Sidebar(team.Prefix + member + team.Suffix);
            if (value != null) return value;
        }
        foreach (string line in scoreLines.Values) { string value = Sidebar(line); if (value != null) return value; }
        int level = xpLevel >= 0 ? xpLevel : Handler.GetLevel();
        if (xpLevel < 0 && level == 0) return "XP unavailable until the server updates it.";
        double baseXP = level <= 16 ? level * level + 6.0 * level : level <= 31 ? 2.5 * level * level - 40.5 * level + 360 : 4.5 * level * level - 162.5 * level + 2220;
        double next = level < 15 ? 2 * level + 7 : level < 30 ? 5 * level - 38 : 9 * level - 158;
        double points = Math.Round(baseXP + Math.Max(0, xpProgress) * next);
        string amount = points >= 1000000 ? (points / 1000000).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + "M" : points >= 1000 ? (points / 1000).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + "K" : points.ToString("0");
        return "~" + amount + " XP (level " + level + ")";
    }
}
