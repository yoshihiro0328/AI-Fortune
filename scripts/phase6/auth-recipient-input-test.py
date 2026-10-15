"""Offline loopback regression tests; synthetic addresses only, no email delivery."""
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.parse import urlencode, urlsplit

SCRIPT = Path(__file__).with_name('auth-recipient-input.py')

class RecipientInputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.proc = subprocess.Popen([sys.executable, str(SCRIPT), str(self.root)],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            if (self.root/'recipient-input-url.txt').exists():
                break
            if self.proc.poll() is not None:
                self.fail('Local input server did not start')
            time.sleep(.02)
        self.url = urlsplit((self.root/'recipient-input-url.txt').read_text())
        self.origin = f'http://{self.url.netloc}'
        self.data = {'a': 'synthetic-a@example.invalid', 'b': 'synthetic-b@example.invalid'}

    def tearDown(self):
        self.proc.terminate()
        self.proc.wait(timeout=3)
        self.temp.cleanup()

    def request(self, method='POST', origin=True, host=None, path=None, data=None):
        headers = {'Content-Type': 'application/x-www-form-urlencoded'}
        if origin is not None:
            headers['Origin'] = self.origin if origin is True else origin
        if host:
            headers['Host'] = host
        conn = http.client.HTTPConnection('127.0.0.1', self.url.port, timeout=2)
        try:
            conn.request(method, path or self.url.path,
                         urlencode(self.data if data is None else data) if method == 'POST' else None,
                         headers)
            res = conn.getresponse()
            return res.status, dict(res.getheaders()), res.read()
        finally:
            conn.close()

    def test_browser_origin_policy(self):
        status, headers, _ = self.request('GET')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Referrer-Policy'], 'same-origin')
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertIn("form-action 'self'", headers['Content-Security-Policy'])

    def test_valid_submission_private_and_no_overwrite(self):
        self.assertEqual(self.request()[0], 200)
        saved = self.root/'recipients.json'
        self.assertEqual(json.loads(saved.read_text()), self.data)
        self.assertEqual(os.stat(saved).st_mode & 0o777, 0o600)
        self.assertEqual(self.request(data={'a':'other-a@example.invalid','b':'other-b@example.invalid'})[0], 409)
        self.assertEqual(json.loads(saved.read_text()), self.data)

    def test_foreign_origin_rejected(self):
        self.assertEqual(self.request(origin='https://untrusted.invalid')[0], 403)
        self.assertFalse((self.root/'recipients.json').exists())

    def test_null_or_missing_origin_rejected(self):
        for origin in ['null', None]:
            self.assertEqual(self.request(origin=origin)[0], 403)
        self.assertFalse((self.root/'recipients.json').exists())

    def test_wrong_host_and_path_rejected(self):
        self.assertEqual(self.request(host='untrusted.invalid')[0], 403)
        self.assertEqual(self.request(path='/wrong')[0], 403)
        self.assertFalse((self.root/'recipients.json').exists())

    def test_identical_addresses_rejected(self):
        self.assertEqual(self.request(data={'a':self.data['a'],'b':self.data['a']})[0], 400)
        self.assertFalse((self.root/'recipients.json').exists())

    def test_malformed_input_rejected(self):
        for data in [{'a':'invalid','b':self.data['b']}, {'a':self.data['a']}]:
            self.assertEqual(self.request(data=data)[0], 400)
        self.assertFalse((self.root/'recipients.json').exists())

    def test_idle_preconnection_does_not_block_form(self):
        with socket.create_connection(('127.0.0.1', self.url.port), timeout=2):
            self.assertEqual(self.request('GET')[0], 200)
            self.assertEqual(self.request()[0], 200)

if __name__ == '__main__':
    unittest.main()
