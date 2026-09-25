"""Generate exact extension backend permission from env; never embeds a key."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import load_dotenv


def configure():
    load_dotenv(Path(__file__).parent / '.env')
    url = urlsplit(os.environ['PUBLIC_APP_URL'])
    if url.scheme != 'https' or not url.netloc or url.username or url.password:
        raise ValueError('PUBLIC_APP_URL must be an HTTPS origin')
    manifest = Path(__file__).resolve().parent.parent / 'extensions/market-qx-observer-v2/manifest.json'
    config = json.loads(manifest.read_text())
    config['optional_host_permissions'] = [f'{url.scheme}://{url.netloc}/*']
    manifest.write_text(json.dumps(config, indent=2) + '\n')


if __name__ == '__main__':
    configure()