#!/usr/bin/env python3
"""Read-only OCI identity and tenancy-wide Always Free preflight."""
import argparse
import configparser
import json
import os
from pathlib import Path
import re
import subprocess


class PreflightError(RuntimeError):
    pass


def identity(environ=None):
    env = os.environ if environ is None else environ
    config = configparser.ConfigParser(interpolation=None)
    path = Path(env.get('OCI_CLI_CONFIG_FILE', str(Path.home() / '.oci/config')))
    if not config.read(path):
        raise PreflightError('Oracle sign-in was not found. Open a fresh Oracle Cloud Shell session.')
    profile = env.get('OCI_CLI_PROFILE', 'DEFAULT')
    if profile != 'DEFAULT' and not config.has_section(profile):
        raise PreflightError('The active Oracle profile is missing. Reopen Cloud Shell.')
    tenancy = config[profile].get('tenancy', '').strip()
    if not re.fullmatch(r'ocid1\.tenancy\.[A-Za-z0-9.\-]+', tenancy):
        raise PreflightError('The active Oracle profile has no valid tenancy.')
    return {'tenancy': tenancy, 'profile': profile}


def cli(*args):
    def run(arguments):
        result = subprocess.run(['oci', *arguments, '--output', 'json'], capture_output=True, text=True, timeout=120,
                                env=dict(os.environ, SUPPRESS_LABEL_WARNING='True'))
        if result.returncode:
            raise PreflightError('Oracle could not complete the read-only check: ' + ' '.join(arguments[:3]) + '. Check your permissions and try again.')
        return result.stdout
    output = run(args)
    # Some OCI CLI paginators emit nothing for an empty --all list. Verify that
    # case with a structured first-page response; never silently assume zero.
    if not output.strip() and '--all' in args and 'list' in args[:3]:
        verified = run([argument for argument in args if argument != '--all'])
        # OCI's official renderer omits *all* output for an empty data list,
        # even without pagination. Two successful list calls with no output
        # are therefore a verified empty list, not a failed read.
        if not verified.strip():
            return []
        try:
            response = json.loads(verified)
            if response.get('data') == [] and not response.get('opc-next-page'):
                return []
        except (ValueError, AttributeError):
            pass
        raise PreflightError('Oracle returned an unverifiable empty resource list.')
    try:
        return json.loads(output)['data']
    except (ValueError, KeyError, TypeError) as exc:
        raise PreflightError('Oracle returned an invalid response; no resources will be created.') from exc


def rows(value):
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise PreflightError('Oracle returned an incomplete resource list; refusing to assume zero usage.')
    return value


def home_region(tenancy, call=cli):
    subscriptions = rows(call('iam', 'region-subscription', 'list', '--tenancy-id', tenancy, '--all'))
    homes = [item.get('region-name') for item in subscriptions if item.get('is-home-region') is True]
    if len(homes) != 1 or not homes[0]:
        raise PreflightError('Could not establish your Oracle home region.')
    return homes[0]


def inventory(tenancy, region, call=cli):
    def query(*args):
        return rows(call(*args, '--region', region, '--all'))
    compartments = [tenancy]
    for item in query('iam', 'compartment', 'list', '--compartment-id', tenancy,
                      '--compartment-id-in-subtree', 'true', '--access-level', 'ANY'):
        if item.get('lifecycle-state') == 'ACTIVE':
            if not item.get('id'):
                raise PreflightError('A compartment cannot be inspected.')
            compartments.append(item['id'])
    ads = [item.get('name') for item in query('iam', 'availability-domain', 'list', '--compartment-id', tenancy)]
    if not ads or not all(ads):
        raise PreflightError('Oracle returned no availability domains.')
    count, storage, seen = 0, 0, set()
    for compartment in set(compartments):
        instances = query('compute', 'instance', 'list', '--compartment-id', compartment)
        count += sum(item.get('shape') == 'VM.Standard.E2.1.Micro' and item.get('lifecycle-state') != 'TERMINATED' for item in instances)
        volumes = query('bv', 'volume', 'list', '--compartment-id', compartment)
        for ad in ads:
            volumes += query('bv', 'boot-volume', 'list', '--compartment-id', compartment, '--availability-domain', ad)
        for volume in volumes:
            if volume.get('lifecycle-state') == 'TERMINATED':
                continue
            size, identifier = volume.get('size-in-gbs'), volume.get('id')
            if not identifier or isinstance(size, bool) or not isinstance(size, (int, float)) or size < 0:
                raise PreflightError('A volume has unknown storage usage; refusing to provision.')
            if identifier not in seen:
                storage += size
                seen.add(identifier)
    return {'e2_count': count, 'storage_gb': storage, 'availability_domains': ads, 'compartments_checked': len(set(compartments))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['identity', 'home', 'inventory'])
    parser.add_argument('--tenancy')
    parser.add_argument('--region')
    args = parser.parse_args()
    try:
        tenant = args.tenancy or identity()['tenancy']
        if args.mode == 'identity':
            print(json.dumps(identity()))
        elif args.mode == 'home':
            print(home_region(tenant))
        else:
            print(json.dumps(inventory(tenant, args.region or home_region(tenant))))
    except (PreflightError, OSError, subprocess.TimeoutExpired) as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == '__main__':
    main()
