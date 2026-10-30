"""Full shell orchestration against strict fake OCI/SSH; no cloud mutations."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

OCI = r'''#!/usr/bin/env python3
import json,os,pathlib,sys
args=sys.argv[1:];family=tuple(args[:3]);root=pathlib.Path(os.environ['FIXTURE_ROOT'])
statefile=root/'cloud.json';state=json.loads(statefile.read_text()) if statefile.exists() else {}
def value(name,default=None): return args[args.index(name)+1] if name in args else default
def reply(data): print(json.dumps({'data':data}));sys.exit(0)
if family==('iam','region','list'): reply([{'name':'home'}])
if family==('iam','region-subscription','list'): reply([{'region-name':'home','is-home-region':True}])
if family==('iam','availability-domain','list'): reply([{'name':'AD1'}])
if family==('iam','compartment','list'): reply([])
if family[:1]==('bv',): reply([])
if family==('compute','shape','list'): reply([{'shape':'VM.Standard.E2.1.Micro'}])
if family==('compute','image','list'): reply([{'id':'ocid1.image.oc1..fixture','display-name':'Canonical-Ubuntu-22.04-Minimal-fixture'}])
instance={'id':'ocid1.instance.oc1..fixture','display-name':'alt-pilot','shape':'VM.Standard.E2.1.Micro','lifecycle-state':'RUNNING','freeform-tags':{'alt-pilot':'managed'}}
if family==('compute','instance','list'): reply([instance] if state.get('vm') else [])
if family==('compute','instance','get'):
 if '--raw-output' in args: print('RUNNING');sys.exit(0)
 reply(instance)
if family==('compute','instance','list-vnics'): reply([{'is-primary':True,'public-ip':'198.51.100.10','subnet-id':'subnet'}])
if family==('compute','instance','launch'):
 allowed={'--availability-domain','--compartment-id','--display-name','--shape','--freeform-tags','--source-details','--subnet-id','--assign-public-ip','--metadata','--output'}
 if any(arg.startswith('--') and arg not in allowed for arg in args[3:]): raise SystemExit('Unsupported launch flag')
 assert value('--shape')=='VM.Standard.E2.1.Micro'
 source=json.loads(value('--source-details'));assert source['bootVolumeSizeInGBs']==50
 assert json.loads(value('--metadata'))['ssh_authorized_keys'].startswith('ssh-ed25519')
 assert not state.get('vm'),'duplicate VM launch'
 state['vm']=True;statefile.write_text(json.dumps(state));reply(instance)
if family[:1]==('network',):
 resource,verb=family[1:]
 if verb=='list':
  if resource=='vcn': reply([{'id':'vcn','display-name':'alt-pilot-vcn','lifecycle-state':'AVAILABLE','freeform-tags':{'alt-pilot':'managed'}}] if state.get('vcn') else [])
  if resource=='route-table': reply([{'id':'rt','vcn-id':'vcn','display-name':'Default Route Table'}])
  if resource=='security-list': reply([{'id':'security-list','display-name':'alt-pilot-ssh','freeform-tags':{'alt-pilot':'managed'}}] if state.get('security-list') else [])
  reply([])
 if verb=='get':
  if resource=='subnet': reply({'id':'subnet','vcn-id':'vcn'})
  if resource=='route-table': reply({'route-rules':[]})
  raise SystemExit('Unexpected network get')
 if verb=='create':
  state[resource]=True;statefile.write_text(json.dumps(state));reply({'id':resource})
 if verb=='update':
  if '--ingress-security-rules' in args:
   rules=json.loads(value('--ingress-security-rules'))
   ports={r['tcpOptions']['destinationPortRange']['min'] for r in rules};assert ports=={22,80,443}
  reply({'id':resource})
raise SystemExit('Unimplemented OCI operation: '+' '.join(args[:3]))
'''
SSH = r'''#!/usr/bin/env python3
import io,json,os,pathlib,sys,tarfile
command=sys.argv[-1];root=pathlib.Path(os.environ['FIXTURE_ROOT'])
if 'mktemp -d' in command: print('/tmp/alt-pilot-setup.FIXTURE1')
elif 'tar -xzf' in command:
 data=sys.stdin.buffer.read()
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
  names=archive.getnames();assert './vm/install-https.sh' in names and './vm/install-bedrock.sh' in names
  assert not any(name.startswith('./.state') for name in names)
elif 'client-state.tar.gz' in command:
 data=sys.stdin.buffer.read()
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
  assert archive.getnames()==['.state/vm.json']
elif 'cat /opt/alt-pilot/initial-control-password' in command: print('FixtureInitialPassword')
elif 'AFK_PUBLIC_IP=' in command:
 assert "AFK_REMOTE_ACCESS='ip'" in command
 with (root/'installs').open('a') as output: output.write('install\n')
'''


class CompleteInstallerTests(unittest.TestCase):
    def test_installs_both_runtimes_ip_https_and_resumes_without_second_vm(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory); checkout=folder/'source'; checkout.mkdir(); fake=folder/'bin';fake.mkdir()
            for name in ('lib','tools','vm'):
                shutil.copytree(ROOT/name,checkout/name,ignore=shutil.ignore_patterns('__pycache__'))
            shutil.copy2(ROOT/'setup-afk.sh',checkout/'setup-afk.sh')
            for name,text in (('oci',OCI),('ssh',SSH),('curl','#!/bin/sh\nexit 0\n')):
                path=fake/name;path.write_text(text);path.chmod(0o755)
            config=folder/'config';config.write_text('[shell]\ntenancy=ocid1.tenancy.oc1..fixture\nregion=wrong\n')
            key=folder/'test.pub';key.write_text('ssh-ed25519 fixture')
            env=dict(os.environ,PATH=str(fake)+os.pathsep+os.environ['PATH'],FIXTURE_ROOT=str(folder),OCI_CLI_CONFIG_FILE=str(config),OCI_CLI_PROFILE='shell',SSH_KEY=str(key),SSH_SOURCE_CIDR='203.0.113.9/32')
            for _ in range(2):
                result=subprocess.run(['bash',str(checkout/'setup-afk.sh'),'--apply'],env=env,capture_output=True,text=True,timeout=30)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
                self.assertIn('JAVA, BEDROCK AND DASHBOARD ARE READY',result.stdout)
                self.assertIn('https://198.51.100.10',result.stdout)
                self.assertNotIn('Tailscale sign-in',result.stdout)
            self.assertEqual((folder/'installs').read_text().splitlines(),['install','install'])
            saved=json.loads((checkout/'.state/vm.json').read_text());self.assertEqual(saved['instance_id'],'ocid1.instance.oc1..fixture')
            saved=json.loads((checkout/'.state/remote-access.json').read_text());self.assertFalse(saved['temporary_url'])
