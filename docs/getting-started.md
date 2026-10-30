# Set up your own ALT Pilot

You do not need to know coding. These instructions use your web browser. Keep
this guide open in one tab and Oracle in another.

## Before you start

You need your own Oracle Cloud account and the Microsoft account that owns your
Minecraft edition. You will get a private installation: your own server, keys,
password and saved Minecraft accounts.

If you do not have Oracle yet, open [Oracle signup](https://signup.cloud.oracle.com)
and follow its identity/payment-method verification. Choose your home region
carefully; Always Free compute must be created there. Do not upgrade to paid
capacity just to get past a setup error. Oracle's current free allowances and
eligibility still apply; this app cannot promise that provider terms never change.

## 1. Open the right box in Oracle

1. Sign in at [Oracle Cloud Console](https://cloud.oracle.com).
2. Look along the top bar for the **Developer Tools** or **>_** icon.
3. Click it, then click **Cloud Shell**. Wait until the command box at the bottom
   finishes opening. It shows a blinking cursor after your Oracle username.

4. At the top of the Cloud Shell box, open **Network** and select **Public**.
   This lets setup download the app. Wait for the network to reconnect.

<details>
<summary><strong>Public is missing from the Network menu? Click here for the one-time fix.</strong></summary>

Oracle sometimes disables Cloud Shell internet access even on a new account.
You can enable it without finding or typing any technical account identifiers.
Click **Copy** on this whole box, paste it into Cloud Shell and press Enter.
Do not change any text. It grants internet access only to your current Oracle
user; it does not grant access to other people or change your VM allowance.

<!-- cloudshell-network-setup -->
```bash
python3 - <<'NETWORK'
import configparser, hashlib, json, os, pathlib, re, subprocess
config = configparser.ConfigParser(interpolation=None)
config.read(os.environ.get('OCI_CLI_CONFIG_FILE', str(pathlib.Path.home()/'.oci/config')))
profile = config[os.environ.get('OCI_CLI_PROFILE', 'DEFAULT')]
tenancy, user = profile.get('tenancy', ''), profile.get('user', '')
if not re.fullmatch(r'ocid1.tenancy.[A-Za-z0-9.-]+', tenancy) or not re.fullmatch(r'ocid1.user.[A-Za-z0-9.-]+', user):
    raise SystemExit('Please restart Cloud Shell, then try this box again.')
name = 'alt-pilot-cloud-shell-' + hashlib.sha256(user.encode()).hexdigest()[:8]
statement = "Allow any-user to use cloud-shell-public-network in tenancy where request.user.id = '" + user + "'"
result = subprocess.run(['oci','iam','policy','list','--compartment-id',tenancy,'--all','--output','json'], check=True, capture_output=True, text=True)
policies = json.loads(result.stdout or '{"data":[]}')['data']
if not any(item.get('name') == name and statement in item.get('statements', []) for item in policies):
    subprocess.run(['oci','iam','policy','create','--compartment-id',tenancy,'--name',name,'--description','Allow this account owner to download ALT Pilot in Cloud Shell','--statements',json.dumps([statement]),'--output','json'], check=True, stdout=subprocess.DEVNULL)
print('Permission ready. In Cloud Shell click Actions -> Restart, then Network -> Public.')
NETWORK
```

Now click **Actions → Restart** in Cloud Shell. When it reopens, choose
**Network → Public**, then continue to step 2 below. Oracle says restarting
applies this permission without waiting for the existing session to refresh.
If you are using a shared/work Oracle account and see a permissions error, its
administrator must approve Cloud Shell internet access; the installer cannot
bypass an administrator's restriction.

</details>

You do not need Oracle's **Create instance** screen. You do not need to create a
VM, upload a key, choose Linux, or install anything on your own computer.

## 2. Paste this one line

Click the **copy** button on this box. Click inside Cloud Shell, paste the line,
then press **Enter**. On Windows/Linux use Ctrl+V; on a Mac use Cmd+V.

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Jlorenzoo/alt-pilot/main/setup-cloudshell.sh)"
```

Setup first checks your Oracle sign-in, home region, existing servers and storage.
It has not created anything at this point. If the checks pass, it asks:

> Ready to set up your cloud computer? Type YES and press Enter:

Type **YES** and press Enter. The installer now:

- Creates your cloud computer using the checked free-eligible E2 Micro shape.
- Creates and stores its connection key for you.
- Sets up the network and firewall.
- Installs **both Java and Bedrock**, the watchdog, and the dashboard.
- Sets up a stable HTTPS address and automatic certificate renewal.
- Checks that your dashboard actually opens before calling setup complete.

There are no domain or tunnel-account signups. Leave Cloud Shell open while
messages scroll. Native client installation can take several minutes; slow
progress is normal on a small free VM. Do not repeatedly paste the command while
an installation is already running.

If the tab closes or your internet drops, open Cloud Shell again and paste the
same line. Setup resumes your saved VM. It does not intentionally create a second
server or erase your signed-in Minecraft accounts.

## 3. Open and bookmark your dashboard

When you see **YOUR CLOUD COMPUTER, JAVA, BEDROCK AND DASHBOARD ARE READY**, find:

- The address beginning with **https://**.
- The **initial dashboard password** printed below it.

Click or copy the address into a new browser tab. It is your VM's IP address,
for example `https://203.0.113.10` (setup prints your real address). Use the printed
password to sign in, then set your own password in **Settings**. Save that password
in your password manager. The initial saved copy does not track changes made from
the remote dashboard.

**Bookmark this page now.** The address survives normal VM stops and restarts.
Deleting the VM or its network address can change it. The HTTPS certificate is
renewed automatically; you do not need to replace it yourself.

Do not bypass a browser certificate warning. If the address does not open safely,
return to Cloud Shell and run the installer again so it can finish/check HTTPS.

## 4. Add your Minecraft account

1. Click **Add account**.
2. Choose **Java**, **Bedrock**, or **Both**. Both uses separate slots, with a
   sign-in for each edition. You need the appropriate Minecraft entitlement.
3. Click **Sign in with Microsoft**.
4. Open the official Microsoft link shown by the app in another tab.
5. Enter the one-time code from ALT Pilot, choose your Microsoft account, and
   approve the sign-in. Enter your Microsoft password only on Microsoft's page.
6. Return to ALT Pilot and wait until your Minecraft name appears.

Your Minecraft sign-in is the one step the installer cannot approve for you.
Tokens needed for unattended reconnects stay privately on your own VM.

## 5. Start and check it

1. In **Settings**, enter the Minecraft server you want to join and the supported
   client version. Save your settings.
2. Select your account, then click **Start**.
3. Wait until its status says **Connected**. Open the console if you need to see
   the server's menu or a message explaining why it cannot join.

Once Connected, you can close Cloud Shell, close the dashboard, and turn off your
computer. The cloud VM keeps running. The watchdog attempts recovery after
connection failures; Minecraft servers and cloud providers can still have outages.

Start with one account. Ten slots can be saved, but a small VM cannot necessarily
run ten clients at once. Bedrock generally needs more memory than Java. Never
share your dashboard password or Microsoft tokens with teammates: each person
can follow this guide to create their own installation.

## Everyday use

Open your bookmark to check status, view chat, start/stop accounts or add another
account. Only add players you trust to the in-game command/TPA whitelist in
Settings. Nobody is trusted by default.

### Lost your bookmark?

Open Oracle Cloud Shell as in step 1 and paste:

```bash
~/alt-pilot/setup-cloudshell.sh --status
```

It prints your saved dashboard address. It does not need to create a new server.

### Forgot your dashboard password?

Open Oracle Cloud Shell and paste:

```bash
~/alt-pilot/setup-cloudshell.sh --reset-password
```

It verifies and repairs your saved installation, then prints a new dashboard
password and signs out old browser sessions. It does not change your Microsoft
password or erase your Minecraft sign-ins. Sign in with the new dashboard
password and change it in Settings.

### Something stopped working?

Paste the original install line from step 2. It checks and repairs the saved
installation. It preserves Minecraft sign-ins. If it says another installer is
already running, return to the other Cloud Shell window and wait for it.

### Oracle says capacity is unavailable or the free allowance is full

Setup stops and does not change to a paid VM shape. Follow the plain-language
message. Wait and try again later for a capacity error. Do not delete servers or
storage you do not recognize. Oracle controls capacity and may reclaim idle
Always Free instances; see [Oracle's policy](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

### Remove the installation

Stop accounts in the dashboard first. In Oracle Console open **Compute →
Instances**, select the VM named **alt-pilot**, then **Terminate**. Read Oracle's
confirmation and choose whether to delete the attached boot volume too. Only
remove the VM you created for this app. This permanently removes its saved
Minecraft sign-ins; it is not the way to fix a temporary connection problem.

## Technical details and references

The default bookmark is HTTPS on the VM's own public IP. [Oracle retains its
public IP through stops](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm).
[Let's Encrypt provides short-lived IP certificates](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability),
and Caddy handles renewal. The dashboard remains on loopback behind this HTTPS
proxy. For administrators who already use Tailscale, `AFK_REMOTE_ACCESS=funnel`
selects the optional stable Funnel route instead; it requires the owner's browser
approval. Normal setup needs none of those extra steps.
