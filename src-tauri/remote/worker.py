
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
        if anchor not in ("match", "matchend", "match[-1]", "matchend[1]", "target"):
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

    region_cache = {}
    def regions(corpus, attr):
        """[(start, end, value)] of one structural attribute, decoded once per request."""
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", attr):
            fail("Unsupported metadata attribute")
        key = (corpus, attr)
        if key not in region_cache:
            out = []
            for row in call([BIN+"cwb-s-decode", "-r", REG, corpus, "-S", attr], timeout=35).splitlines():
                cols = row.split("\t", 2)
                if len(cols) != 3: continue
                try: out.append((int(cols[0]), int(cols[1]), cols[2]))
                except ValueError: continue
            region_cache[key] = out
        return region_cache[key]

    def filter_ok(f, value):
        kind = f.get("op") or "is"
        if kind == "years":
            m = re.match(r"(\d{4})", value)
            return bool(m) and int(f["from"]) <= int(m.group(1)) <= int(f["to"])
        hit = value in set(f.get("values", []))
        return hit if kind == "is" else not hit

    def kept_regions(corpus, filters):
        """Region spans (start, end) that satisfy every filter, or None when the
        filters sit on differently segmented attributes (no common regions)."""
        keep = None
        for f in filters:
            spans = {(s, e) for s, e, v in regions(corpus, f["attr"]) if filter_ok(f, v)}
            every = {(s, e) for s, e, v in regions(corpus, f["attr"])}
            if keep is None:
                keep, frame = spans, every
            else:
                if every != frame:
                    return None
                keep &= spans
        return keep

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
            counted = total
            if total == 0:
                lines = []
            elif req.get("group_anchor") == "phrase":
                # Whole matched span: tabulate the attribute over match..matchend and count here.
                field = req["group_field"]
                if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", field):
                    fail("Unsupported attribute")
                counted = min(total, int(req.get("cap", 200000)))
                rows = sections(cqp(script + "tabulate GUIQuery 0 %d match..matchend %s;\n.EOL.;\n" % (counted-1, field)))[0]
                tally = {}
                for row in rows:
                    key = " ".join(row.split())
                    if req.get("fold_case"): key = key.lower()
                    tally[key] = tally.get(key, 0) + 1
                lines = ["%s\t%d" % (k, n) for k, n in sorted(tally.items(), key=lambda kv: -kv[1])]
            else:
                lines = sections(cqp(script + "group GUIQuery " + safe_group_anchor() + " " + req["group_field"] + ";\n.EOL.;\n"))[0]
            print(json.dumps({"ok": True, "total":total, "counted":counted, "lines":lines[:2000], "truncated":len(lines)>2000}, ensure_ascii=False))
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
        for item in req['compiled']:
            corpus, expression, base = item[0], item[1], item[2]
            filters = item[3] if len(item) > 3 else []
            script='set PrettyPrint off;\n'+corpus+';\nGUIQuery = '+expression+';\n'
            total=size_of(script)
            sub = None
            if filters:
                kept = kept_regions(corpus, filters)
                if kept is not None:
                    sub = sum(e - s + 1 for s, e in kept)
            tokens = sub if sub is not None else base
            observed.append({'corpus':corpus,'total':total,'tokens':tokens,
                             'subcorpus': bool(filters), 'subcorpus_measured': sub is not None,
                             'per_million_tokens':round(total*1000000/tokens,4) if tokens else 0})
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
        filters = req.get("filters") or []
        kept = kept_regions(req["corpus"], filters) if filters else None
        aligned = True
        if filters and kept is not None:
            # Group sizes count only regions that pass the filters, so rates use the
            # same subcorpus as the matches. Needs the grouping attribute to share the
            # filters' segmentation (e.g. all text_* attributes).
            if {(s, e) for s, e, v in regions(req["corpus"], attr)} != {(s, e) for s, e, v in regions(req["corpus"], filters[0]["attr"])}:
                aligned = False
        elif filters:
            aligned = False
        sizes = {}
        for s0, e0, val in regions(req["corpus"], attr):
            if filters and aligned and (s0, e0) not in kept:
                continue
            r = sizes.setdefault(val, [0, 0]); r[0] += 1; r[1] += e0 - s0 + 1
        vals = [[v, hits.get(v, 0), s[0], s[1]] for v, s in sizes.items()]
        vals += [[v, h, 0, 0] for v, h in hits.items() if v not in sizes]
        vals.sort(key=lambda r: (-r[1], -r[3]))
        print(json.dumps({"ok": True, "total": total, "counted": n, "values": vals[:1000], "truncated": len(vals) > 1000,
                          "sizes_filtered": bool(filters) and aligned}, ensure_ascii=False))
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
                m = re.match(r'^##::\s*language\s*=\s*"?([A-Za-z?_-]+)"?', s)
                if m: info["language"] = m.group(1)[:16]; continue
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
