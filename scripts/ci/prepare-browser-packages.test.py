import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("prepare", Path(__file__).with_name("prepare-browser-packages.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MirrorTest(unittest.TestCase):
    def test_changes_only_exact_known_origin_and_preserves_signature_policy(self):
        source = "Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
        result = module.official_archive(source)
        self.assertEqual(result, source.replace("http://azure.archive.ubuntu.com", "https://archive.ubuntu.com"))
        for other in ["https://security.ubuntu.com/ubuntu", "https://example.test/ubuntu", "http://azure.archive.ubuntu.com/ubuntu-other"]:
            self.assertEqual(module.official_archive(other), other)
        self.assertEqual(module.official_archive(result), result)

    def test_isolated_mirror_list_and_deb822_leave_unrelated_files_intact(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "sources.list.d").mkdir()
            mirror = root / "apt-mirrors.txt"
            mirror.write_text("http://azure.archive.ubuntu.com/ubuntu\n")
            source = root / "sources.list.d" / "ubuntu.sources"
            source.write_text("URIs: mirror+file:/etc/apt/apt-mirrors.txt\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n")
            before = source.read_text()
            result = module.configure(root)
            self.assertEqual(result["changedSourceFiles"], 1)
            self.assertEqual(source.read_text(), before)
            self.assertEqual(mirror.read_text(), "https://archive.ubuntu.com/ubuntu\n")
            config = (root / "apt.conf.d" / "80-yorisoi-download-bounds").read_text()
            self.assertNotIn("AllowInsecure", config)
            self.assertNotIn("Verify-Peer", config)
            self.assertEqual(module.configure(root)["changedSourceFiles"], 0)


if __name__ == "__main__":
    unittest.main()
