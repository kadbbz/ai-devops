# 只读取压缩包，不使用外部解压命令，不执行项目文件。
import sys, os, json, zipfile, tarfile, stat
source, destination = sys.argv[1:3]
required = sys.argv[3] if len(sys.argv) > 3 else 'agent.md'
MAX_FILE = 32 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
try:
    zipped = zipfile.is_zipfile(source)
    archive = zipfile.ZipFile(source) if zipped else tarfile.open(source, 'r:*')
    entries = archive.infolist() if zipped else archive
    seen, records, total = {}, [], 0
    for count, e in enumerate(entries):
        if count >= 10000: raise ValueError('条目数量超过限制')
        name = e.filename if zipped else e.name
        while name.startswith('./'): name = name[2:]
        if name in ('', '.'): continue
        parts = name.rstrip('/').split('/')
        if name.startswith('/') or '\\' in name or any(p in ('..', '.', '') or ':' in p or any(ord(c)<32 for c in p) for p in parts): raise ValueError('不安全路径')
        directory = e.is_dir() if zipped else e.isdir()
        mode = (e.external_attr >> 16) if zipped else e.mode
        if zipped:
            kind = stat.S_IFMT(mode)
            if kind not in (0, stat.S_IFDIR, stat.S_IFREG): raise ValueError('不支持链接或特殊文件')
        elif not (e.isfile() or directory): raise ValueError('不支持链接或特殊文件')
        name = '/'.join(parts)
        folded = name.casefold()
        if folded in seen: raise ValueError('重复路径或大小写冲突')
        seen[folded] = directory
        size = e.file_size if zipped else e.size
        total += size
        if size > MAX_FILE or total > MAX_TOTAL: raise ValueError('展开大小超过限制')
        records.append((e, name, directory, mode, size))
    for _, name, _, _, _ in records:
        parts = name.split('/')
        for i in range(1, len(parts)):
            if seen.get('/'.join(parts[:i]).casefold()) is False: raise ValueError('文件目录冲突')
    # 排除系统元数据后，允许单层仓库名称包装。
    records = [r for r in records if r[1].split('/')[0] != '__MACOSX' and not any(p == '.DS_Store' or p.startswith('._') for p in r[1].split('/'))]
    paths = [r[1] for r in records if not r[2]]
    prefix = ''
    if required not in paths:
        roots = {p.split('/')[0] for p in paths}
        if len(roots) == 1: prefix = next(iter(roots)) + '/'
    result, contract = [], False
    for e, name, directory, mode, size in records:
        if directory: continue
        name = name[len(prefix):] if prefix else name
        if any(p.casefold() in ('.git', '.devops') for p in name.split('/')): continue
        stream = archive.open(e) if zipped else archive.extractfile(e)
        with stream: data = stream.read(min(size, MAX_FILE) + 1)
        if len(data) != size: raise ValueError('展开大小不匹配')
        if name == required:
            contract = bool(data.decode('utf-8').strip())
        target = os.path.join(destination, str(len(result)))
        with open(target, 'wb') as out: out.write(data)
        result.append({'path':name, 'file':target, 'mode':'100755' if mode & 0o111 else '100644'})
    if not contract: raise ValueError('压缩包必须包含非空 UTF-8 ' + required)
    print(json.dumps(result))
except Exception as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
