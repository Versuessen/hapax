
import csv, io, json, os, re, subprocess, sys
ROOT = "/home/s/structeng/cwb"
REG = "/home/s/structeng/firth/registry"
BIN = ROOT + "/bin/"


def fail(msg):
    print(json.dumps({"ok": False, "error": str(msg)[-1400:]}, ensure_ascii=False))
    raise SystemExit(0)

try:
    req = json.load(sys.stdin)
    op = req["op"]
    # Non-interactive ssh does not source the interactive CWB library setup.
    found = subprocess.run(["find", ROOT, "-name", "libcl.so", "-print", "-quit"],
                           capture_output=True, text=True, timeout=12)
    files = found.stdout.strip().splitlines()
    if found.returncode or not files:
        fail("Cannot locate CWB shared library libcl.so")
    env = dict(os.environ)
    env["LD_LIBRARY_PATH"] = os.path.dirname(files[0]) + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")

    def call(argv, data=None, timeout=45):
        cp = subprocess.run(argv, input=data, capture_output=True, text=True,
                            encoding="utf-8", errors="replace", env=env, timeout=timeout)
        if cp.returncode != 0 or "CQP Error:" in cp.stderr or "PARSE ERROR" in cp.stderr:
            fail((cp.stderr or cp.stdout or "Command failed")[-1200:])
        if len(cp.stdout) > 8_000_000:
            fail("Result exceeds 8 MB; narrow your query")
        return cp.stdout

    def cqp(script):
        return call([BIN + "cqp", "-c", "-p", "-r", REG], script)

    def safe_group_anchor():
        anchor = req.get("group_anchor", "match")
        if anchor not in ("match", "matchend", "match[-1]", "matchend[1]"):
            fail("Unsupported group position")
        return anchor

    def sections(out):
        result, part = [], []
        for line in out.splitlines():
            if line.strip() == "-::-EOL-::-":
                result.append(part)
                part = []
            elif not line.startswith("CQP version "):
                part.append(line)
        if not result:
            fail("No CQP response marker")
        return result

    def size_of(script):
        s = sections(cqp(script + "size GUIQuery;\n.EOL.;\n"))[0]
        found = [int(x.strip()) for x in s if re.fullmatch(r"\s*\d+\s*", x)]
        if len(found) != 1:
            fail("Unexpected CQP match count: " + repr(s[:3]))
        return found[0]

    if op == "health":
        cp = call([BIN + "cqp", "-v"], timeout=15)
        print(json.dumps({"ok": True, "message": "CWB runtime reachable", "version": "3.5.1" if "3.5.1" in cp else "CQP detected"}))
    elif op in ("search", "export", "frequencies", "collocates"):
        corpus = req["corpus"]
        script = "set PrettyPrint off;\n" + corpus + ";\n" + ("set Context 4 words;\n" if op == "collocates" else "") + "GUIQuery = " + req["expression"] + ";\n"
        total = size_of(script)
        if op in ("search", "export"):
            off, lim, ctx = int(req["offset"]), int(req["limit"]), int(req["context"])
            rows = []
            if off < total:
                end = min(total-1, off+lim-1)
                meta = req.get("source_attribute")
                specification = ("match, matchend, match[-%d]..match[-1] word, "
                                 "match..matchend word, matchend[1]..matchend[%d] word" % (ctx,ctx))
                if meta:
                    specification += ", match " + meta
                sort_cmd = {"match": "sort GUIQuery by word %cd;\n",
                            "left": "sort GUIQuery by word %cd on match[-1];\n",
                            "right": "sort GUIQuery by word %cd on matchend[1];\n"}
                sort_key = req.get("sort") or ""
                if sort_key and sort_key not in sort_cmd:
                    fail("Unsupported sort order")
                rows = sections(cqp(script + sort_cmd.get(sort_key, "") + "tabulate GUIQuery %d %d %s;\n.EOL.;\n" % (off,end,specification)))[0]
            print(json.dumps({"ok": True, "total":total, "rows":rows}, ensure_ascii=False))
        elif op == "frequencies":
            if total == 0:
                lines = []
            else:
                lines = sections(cqp(script + "group GUIQuery " + safe_group_anchor() + " " + req["group_field"] + ";\n.EOL.;\n"))[0]
            print(json.dumps({"ok": True, "total":total, "lines":lines[:2000], "truncated":len(lines)>2000}, ensure_ascii=False))
        else:
            num = min(total, int(req["sample_limit"]))
            csvlines = ""
            if num:
                # University collocates.pl expects the angle-bracketed cat format.
                raw = cqp(script + "cat GUIQuery 0 %d;\n.EOL.;\n" % (num-1))
                lines = [line for line in raw.splitlines() if re.match(r"^\s*\d+:", line)]
                cp = call(["/home/s/structeng/scripts/collocates.pl", "--list", "--case", "/dev/stdin"],
                          "\n".join(lines)+"\n", timeout=20)
                csvlines = cp
            print(json.dumps({"ok":True,"total":total,"sampled":num,"csv":csvlines},ensure_ascii=False))
    elif op == "workflow":
        # Run one persistent child-mode CQP per workflow, checking the actual
        # match count after every step. An empty CQP query result may not be a
        # TEMP result; asking `subset` to refine it has caused an assertion in
        # the university's CQP 3.5.1 installation. Keep empty sets *virtual*,
        # and simplify set operations mathematically instead.
        import select, time
        proc = subprocess.Popen([BIN + "cqp", "-c", "-p", "-r", REG],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, env=env, bufsize=0)
        carry = [b""]
        marker = b"-::-EOL-::-"
        try:
            def exchange(commands, label, timeout=45):
                if proc.poll() is not None:
                    fail("CQP ended unexpectedly before " + label)
                try:
                    proc.stdin.write((commands + "\n.EOL.;\n").encode("utf-8"))
                    proc.stdin.flush()
                except (BrokenPipeError, OSError):
                    fail("CQP process ended while executing " + label)
                deadline = time.monotonic() + timeout
                raw = bytearray()
                while True:
                    # Data from a single read can include the next CQP prompt or
                    # extra lines. Preserve everything after the marker.
                    split = carry[0].find(marker + b"\n")
                    if split >= 0:
                        raw.extend(carry[0][:split])
                        carry[0] = carry[0][split+len(marker)+1:]
                        break
                    if carry[0]:
                        raw.extend(carry[0])
                        carry[0] = b""
                    if len(raw) > 8_000_000:
                        fail("CQP result exceeds the 8 MB safety limit")
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        fail("CQP timed out at " + label + "; narrow your search")
                    ready, _, _ = select.select([proc.stdout], [], [], remaining)
                    if not ready:
                        fail("CQP timed out at " + label + "; narrow your search")
                    chunk = os.read(proc.stdout.fileno(), 65536)
                    if not chunk:
                        fail("CQP exited unexpectedly at " + label +
                             " (possible internal assertion); try simplifying this step")
                    carry[0] += chunk
                output = raw.decode("utf-8", "replace")
                if any(term in output for term in
                       ("CQP Error:", "PARSE ERROR", "Assertion `", "Assertion '", "assertion failed")):
                    fail("CQP rejected " + label + ": " + output[-850:])
                return [line for line in output.splitlines()
                        if line.strip() and not line.startswith("CQP version ")]

            def evaluate(assign, name, label):
                lines = exchange(assign + "\nsize " + name + ";", label)
                values = [int(x.strip()) for x in lines if re.fullmatch(r"\s*\d+\s*", x)]
                if len(values) != 1:
                    fail("Unexpected result count at " + label + ": " + repr(lines[:5]))
                return values[0]

            exchange("set PrettyPrint off;\n" + req["plan"]["corpus"] + ";", "startup")
            prepared = req["script"].splitlines()[2:]
            counts, names, messages = [], [], []
            for i, step in enumerate(req["plan"]["steps"], start=1):
                label = "step " + str(i)
                own = "Q" + str(i)
                lines = [line for line in prepared
                         if re.match(r"^(?:Q|R)" + str(i) + r" = ", line)]
                if step["kind"] == "search":
                    count = evaluate(lines[0], own, label)
                    ref = own if count else None
                elif step["kind"] == "refine":
                    base = names[int(step["source"])-1]
                    if base is None:
                        ref, count = None, 0
                    else:
                        clause = lines[0].split(" where ",1)[1]
                        if step["mode"] == "keep":
                            count = evaluate(own + " = subset " + base + " where " + clause,
                                             own, label)
                            ref = own if count else None
                        else:
                            intermediate = "R" + str(i)
                            removed = evaluate(intermediate + " = subset " + base + " where " + clause,
                                               intermediate, label + " exclusion filter")
                            if removed == 0:
                                ref, count = base, counts[int(step["source"])-1]
                            else:
                                count = evaluate(own + " = difference " + base + " " + intermediate + ";",
                                                 own, label)
                                ref = own if count else None
                elif step["kind"] == "combine":
                    a, b = int(step["left"])-1, int(step["right"])-1
                    left, right = names[a], names[b]
                    method = step["method"]
                    if method == "union" and (left is None or right is None):
                        ref = right if left is None else left
                        count = counts[b] if left is None else counts[a]
                    elif method == "intersection" and (left is None or right is None):
                        ref, count = None, 0
                    elif method == "difference" and left is None:
                        ref, count = None, 0
                    elif method == "difference" and right is None:
                        ref, count = left, counts[a]
                    elif left == right:
                        ref, count = (None, 0) if method == "difference" else (left, counts[a])
                    else:
                        count = evaluate(own + " = " + method + " " + left + " " + right + ";",
                                         own, label)
                        ref = own if count else None
                else:
                    fail("Unrecognized workflow step " + str(i))
                names.append(ref)
                counts.append(count)
                messages.append({"step": i, "kind": step["kind"], "matches": count})
            total = counts[-1]
            final = names[-1]
            mode = req["mode"]
            if not total:
                print(json.dumps({"ok": True, "total":0,
                    "rows":[], "lines":[], "truncated":False, "step_counts":messages,
                    "sampling_method":("full-result seeded random ordering" if mode=="sample" else "corpus order"),
                    "seed":(req.get("seed") if mode=="sample" else None)}))
            elif mode in ("results", "export", "sample"):
                if mode == "sample":
                    seed = int(req.get("seed",42))
                    exchange("SampleResult = " + final + ";\nsort SampleResult randomize " + str(seed) + ";", "random sample", timeout=90)
                    final = "SampleResult"
                start, limit, ctx = (0 if mode == "sample" else int(req["offset"])), int(req["limit"]), int(req["context"])
                rows=[]
                if start < total:
                    cols = ("match, matchend, match[-%d]..match[-1] word, "
                            "match..matchend word, matchend[1]..matchend[%d] word" % (ctx,ctx))
                    if req.get("source_attribute"):
                        cols += ", match " + req["source_attribute"]
                    rows = exchange("tabulate " + final + " " + str(start) + " " +
                        str(min(total-1,start+limit-1)) + " " + cols + ";", "result page")
                print(json.dumps({"ok":True, "total":total,"rows":rows,
                                  "step_counts":messages, "sampling_method": ("full-result seeded random ordering" if mode=="sample" else "corpus order"), "seed": (req.get("seed") if mode=="sample" else None)},ensure_ascii=False))
            else:
                lines=exchange("group " + final + " " + safe_group_anchor() + " " + req["group_field"] + ";", "group results")
                print(json.dumps({"ok":True,"total":total,"lines":lines[:2000],
                                  "truncated":len(lines)>2000,"step_counts":messages},ensure_ascii=False))
        finally:
            if proc.poll() is None:
                proc.terminate()
                try: proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=2)
            for pipe in (proc.stdin, proc.stdout):
                if pipe is not None: pipe.close()
    elif op == "compare":
        observed=[]
        for corpus,expression,base in req['compiled']:
            script='set PrettyPrint off;\n'+corpus+';\nGUIQuery = '+expression+';\n'
            total=size_of(script)
            observed.append({'corpus':corpus,'total':total,'tokens':base,
                             'per_million_tokens':round(total*1000000/base,4)})
        print(json.dumps({'ok':True,'results':observed},ensure_ascii=False))
    elif op == "lexicon":
        raw = call([BIN+"cwb-lexdecode", "-r", REG, "-f", "-P", req["field"], req["corpus"]], timeout=35)
        lines = [line for line in raw.splitlines() if line.strip()]
        print(json.dumps({"ok":True,"lines":lines[:2500],"truncated":len(lines)>2500},ensure_ascii=False))
    elif op == "metadata":
        raw = call([BIN+"cwb-s-decode", "-r", REG, req["corpus"], "-S", req["attribute"]],timeout=35)
        result={}
        for row in raw.splitlines():
            cols=row.split("\t",2)
            if len(cols)!=3: continue
            try:
                size=int(cols[1])-int(cols[0])+1
            except ValueError: continue
            val=cols[2]
            if val not in result: result[val]=[0,0]
            result[val][0]+=1
            result[val][1]+=size
        vals=sorted(result.items(),key=lambda v:-v[1][1])
        print(json.dumps({"ok":True,"values":vals[:1000],"truncated":len(vals)>1000},ensure_ascii=False))
    elif op == "distribution":
        attr = req["attribute"]
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", attr):
            fail("Unsupported metadata attribute")
        script = "set PrettyPrint off;\n" + req["corpus"] + ";\nGUIQuery = " + req["expression"] + ";\n"
        total = size_of(script)
        n = min(total, int(req.get("cap", 200000)))
        hits = {}
        if n:
            for line in sections(cqp(script + "tabulate GUIQuery 0 %d match %s;\n.EOL.;\n" % (n-1, attr)))[0]:
                hits[line] = hits.get(line, 0) + 1
        raw = call([BIN+"cwb-s-decode", "-r", REG, req["corpus"], "-S", attr], timeout=35)
        sizes = {}
        for row in raw.splitlines():
            cols = row.split("\t", 2)
            if len(cols) != 3: continue
            try: size = int(cols[1]) - int(cols[0]) + 1
            except ValueError: continue
            r = sizes.setdefault(cols[2], [0, 0]); r[0] += 1; r[1] += size
        vals = [[v, hits.get(v, 0), s[0], s[1]] for v, s in sizes.items()]
        vals += [[v, h, 0, 0] for v, h in hits.items() if v not in sizes]
        vals.sort(key=lambda r: (-r[1], -r[3]))
        print(json.dumps({"ok": True, "total": total, "counted": n, "values": vals[:1000], "truncated": len(vals) > 1000}, ensure_ascii=False))
    elif op == "registry":
        # Which corpora exist right now. Registry files are small text files;
        # only corpora the app does not already know are described in detail.
        known = set(x.lower() for x in req.get("known", []))
        found = []
        try:
            names = sorted(os.listdir(REG))
        except OSError as e:
            fail("Cannot read the corpus registry: " + str(e))
        for fn in names[:400]:
            path = os.path.join(REG, fn)
            if fn.startswith(".") or not os.path.isfile(path):
                continue
            info = {"id": fn, "name": "", "charset": "", "positional": [], "structural": [], "annotated": []}
            try:
                with open(path, encoding="utf-8", errors="replace") as fh:
                    text = fh.read(200000)
            except OSError:
                continue
            for line in text.splitlines():
                s = line.strip()
                m = re.match(r'^ID\s+(\S+)', s)
                if m: info["id"] = m.group(1); continue
                m = re.match(r'^NAME\s+"(.*)"', s)
                if m: info["name"] = m.group(1)[:200]; continue
                m = re.match(r'^##::\s*charset\s*=\s*"?([A-Za-z0-9_-]+)"?', s)
                if m: info["charset"] = m.group(1); continue
                m = re.match(r'^ATTRIBUTE\s+(\S+)', s)
                if m: info["positional"].append(m.group(1)); continue
                m = re.match(r'^STRUCTURE\s+(\S+)(.*)$', s)
                if m:
                    info["structural"].append(m.group(1))
                    if "[annotations]" in m.group(2): info["annotated"].append(m.group(1))
            if info["id"].lower() not in known and len(found) < 400:
                try:
                    # Not via call(): a corpus that fails to describe must not abort discovery.
                    desc = subprocess.run([BIN + "cwb-describe-corpus", "-s", "-r", REG, info["id"].upper()],
                                          capture_output=True, text=True, encoding="utf-8", errors="replace",
                                          env=env, timeout=20).stdout
                    m = re.search(r"size \(tokens\):\s*(\d+)", desc)
                    if m: info["tokens"] = int(m.group(1))
                    info["regions"] = {a: int(n) for a, n in re.findall(r"s-ATT\s+(\S+)\s+(\d+)\s+regions", desc)}
                except Exception:
                    pass
            found.append(info)
        print(json.dumps({"ok": True, "corpora": found}, ensure_ascii=False))
    elif op == "syntax":
        pos=int(req["position"])
        tok = call([BIN+"cwb-decode","-r",REG,"-C","-s",str(pos),"-e",str(pos),"EFCAM","-P","tokid"])
        try: index=int(tok.strip().splitlines()[0].split("\t")[0])
        except (ValueError,IndexError): fail("Cannot locate sentence-local token ID")
        start=pos-index+1
        if start<0: fail("Invalid sentence start")
        maxend=min(36353680, start+254)
        raw=call([BIN+"cwb-decode","-r",REG,"-C","-s",str(start),"-e",str(maxend),"EFCAM",
                  "-P","word","-P","pos","-P","lemma","-P","tokid","-P","head","-P","rel"],timeout=30)
        rows=[]
        for line in raw.splitlines():
            parts=line.split("\t")
            if len(parts)!=6: fail("Unexpected EFCAM token row")
            if rows and parts[3]=="1": break
            rows.append({"position":start+len(rows),"word":parts[0],"pos":parts[1],"lemma":parts[2],
                         "id":parts[3],"head":parts[4],"rel":parts[5]})
        if not rows or rows[0]["id"]!="1": fail("Cannot establish complete sentence boundary")
        if len(rows)>=255: fail("Sentence exceeds 255-token safety limit")
        print(json.dumps({"ok":True,"start":start,"tokens":rows},ensure_ascii=False))
    else:
        fail("Unsupported operation")
except subprocess.TimeoutExpired:
    fail("Remote analysis timed out; narrow the query or metadata selection")
except Exception as error:
    fail(type(error).__name__ + ": " + str(error))
