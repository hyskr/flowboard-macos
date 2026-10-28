#!/usr/bin/env python3
"""FlowBoard connection and batched task updates."""
import argparse
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def config_path():
    return Path(os.environ.get('FLOWBOARD_CONFIG', '~/.config/flowboard/connection.json')).expanduser()


def write_private(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', opener=lambda name, flags: os.open(name, flags, 0o600)) as out:
        json.dump(data, out, ensure_ascii=False, indent=2)
    path.chmod(0o600)


def load_connection(path):
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or not all(isinstance(data.get(k), str) and data[k] for k in ('workerUrl', 'boardId', 'keyHash')):
        raise ValueError('连接配置需要 workerUrl、boardId 和 keyHash。')
    url = urlparse(data['workerUrl'])
    if url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ('localhost', '127.0.0.1')):
        raise ValueError('网站地址需要 HTTPS；本地预览可以使用 HTTP。')
    return data


def request(config, route, extra=None):
    headers = {'Content-Type': 'application/json'}
    if config.get('sitesToken'):
        headers['OAI-Sites-Authorization'] = 'Bearer ' + config['sitesToken']
    req = Request(config['workerUrl'].rstrip('/') + route,
                  data=json.dumps({'boardId': config['boardId'], 'keyHash': config['keyHash'], **(extra or {})}).encode(),
                  headers=headers, method='POST')
    try:
        with urlopen(req, timeout=20) as response:
            result = json.load(response)
        if not isinstance(result, dict):
            raise ValueError('网站没有返回有效的看板响应。')
        return result
    except HTTPError as error:
        try:
            detail = json.loads(error.read()).get('error', '')
        except (ValueError, AttributeError):
            detail = '请检查连接配置和网站访问权限。'
        raise ValueError(f'HTTP {error.code}: {detail}') from None
    except (URLError, TimeoutError, json.JSONDecodeError):
        raise ValueError('无法读取网站响应，请检查网络和网站访问权限。') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['connect', 'status', 'read', 'batch', 'pending', 'retry', 'discard'])
    parser.add_argument('file', nargs='?')
    args = parser.parse_args()
    path = config_path()
    pending = path.with_name('pending.json')
    if args.command == 'connect':
        if not args.file:
            raise ValueError('connect 需要连接配置文件的路径。')
        config = load_connection(Path(args.file).expanduser())
        request(config, '/api/tasks/read')
        write_private(path, config)
        return {'connected': True, 'boardId': config['boardId']}
    if args.command == 'status':
        return {'configured': path.exists(), 'pending': pending.exists()}
    if args.command == 'pending':
        return json.loads(pending.read_text()) if pending.exists() else {'actions': []}
    if args.command == 'discard':
        pending.unlink(missing_ok=True)
        return {'discarded': True}
    if not path.exists():
        raise ValueError('尚未连接看板。请在网站下载连接配置并使用 connect 导入。')
    config = load_connection(path)
    if args.command == 'read':
        return request(config, '/api/tasks/read')
    if args.command == 'batch':
        if pending.exists():
            raise ValueError('存在未同步操作。请先用 pending 查看，确认后 retry，或 discard 后提交最终内容。')
        actions = json.load(sys.stdin)
        if not isinstance(actions, list) or not 1 <= len(actions) <= 20:
            raise ValueError('标准输入需要包含 1–20 项操作的 JSON 数组。')
        payload = {'boardId': config['boardId'], 'actions': actions}
        write_private(pending, payload)
    else:
        if not pending.exists():
            return {'ok': True, 'results': [], 'operations': 0}
        payload = json.loads(pending.read_text())
        if payload['boardId'] != config['boardId']:
            raise ValueError('未同步操作属于其他看板，请先查看并处理。')
    result = request(config, '/api/tasks/batch', {'actions': payload['actions']})
    if result.get('ok') is not True:
        raise ValueError('网站未确认保存；操作保留在 pending 中。')
    pending.unlink()
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False, indent=2))
    except (ValueError, OSError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
