"""Allowlisted Docker startup diagnostics. Never return raw process output or argv."""
import json
import re

IMAGE = 'public.ecr.aws/supabase/postgres:17.11.0.004'


def failure(stage, code, stderr):
    if stage not in ('engine', 'container_start', 'readiness'):
        raise ValueError('Not a Docker startup stage')
    message = stderr.decode('utf-8', errors='replace').lower()
    categories = [
        ('registry_rate_limit', ('toomanyrequests', 'too many requests', 'pull rate limit', '429')),
        ('platform_unavailable', ('no matching manifest', 'exec format error')),
        ('manifest_missing', ('manifest unknown', 'manifest not found')),
        ('daemon_permission', ('permission denied', 'operation not permitted')),
        ('daemon_unavailable', ('cannot connect to the docker daemon', 'is the docker daemon running')),
        ('registry_authorization', ('pull access denied', 'unauthorized', 'authentication required')),
        ('storage_full', ('no space left on device', 'disk quota exceeded')),
        ('network_or_tls', ('timeout', 'timed out', 'no such host', 'tls handshake', 'x509:', 'connection refused')),
        ('container_name_conflict', ('container name', 'already in use')),
        ('invalid_run_option', ('unknown flag', 'invalid argument', 'unknown shorthand flag')),
    ]
    category = next((name for name, needles in categories if any(n in message for n in needles)), 'unclassified')
    return {'stage': stage, 'exitCode': int(code), 'category': category,
            'image': IMAGE, 'rawOutputSuppressed': True}


def engine_metadata(stdout):
    """Accept only version and platform fields, never daemon names/addresses."""
    try:
        data = json.loads(stdout)
    except (ValueError, UnicodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    version = data.get('Version', '')
    return {'dockerVersion': version if isinstance(version, str) and re.fullmatch(r'\d+\.\d+\.\d+', version) else 'unavailable',
            'os': data.get('Os') if data.get('Os') in ('linux', 'windows', 'darwin') else 'unavailable',
            'arch': data.get('Arch') if data.get('Arch') in ('amd64', 'arm64', 'arm', '386') else 'unavailable',
            'image': IMAGE}
