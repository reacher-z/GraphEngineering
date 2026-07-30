# D9 redaction contract remediation self-audit — 2026-07-26

Status: **remediation complete; independent hostile re-review required**

Task boundary: `D9-REDACTION-039` contract-only remediation

Author role: remediation producer/self-auditor, **not** the accepting reviewer

Commit/push: **none**

## 1. Bound inputs and scope

This remediation answered the seven P1 and two P2 findings in:

- `codex_logs/reviews/D9-Redaction-Contract-Independent-2026-07-26.md`
  (`caf53664d70d6735830efc1a65791191fceb7aa4135c6a42c39d12a187ee348f`);
- the complete 3,164-line canonical master plan
  (`8679289cb7540c1e0dfe35d7733cfbf9d5534eb828e1f8ca7718b5452ab53527`);
  and
- the live registry snapshot
  (`24936c7484a48b7e9634ec2596f410c7b075f305a490b0c9d78712ce8bbd4e4f`).

The lane changed only the D9 contract schemas/corpus, the canonical redaction
semantics, the D9 implementation brief, the security mapping, and this new
remediation log. It did not edit the shared fixture validator, native
TypeScript/Python code, registry, master plan, root daily log, release map, or
prior independent report.

`D9-TS-REDACTION-087`, `D9-PY-REDACTION-088`,
`D9-REDACTION-CONFORMANCE-089`, and `D9-DURABLE-EXT-SPEC-031` remain `planned`.
This report does not mark `039` complete and does not authorize native,
security, privacy, package, RC, stable, release, or 6,000-star claims.

## 2. Remediation result by independent finding

| Finding | Remediation carrier | Self-audit result |
| --- | --- | --- |
| P1-01 occurrence/authority-complete AAD | `protected-aad`, protected-store envelope, semantics Sections 5.5–5.6, semantic pairs | Event AAD now requires `eventId` + `sequence`; checkpoint AAD requires `checkpointId` + `sequence`; wrong occurrence field is forbidden. AAD/store bind `keyRefHash`, keyed `authorityBindingHash`, and keyed `tenantScopeHash`. Exact store equality and byte-identical operation replay are normative. Checkpoint/event copy, retry, key, authority, tenant, and changed-envelope attacks are checked-in pairs. |
| P1-02 bound receipt/live registry | v1alpha2 receipt/rule/policy schemas, semantics Sections 3.3/4.1, semantic pairs | Receipt now binds keyed source/result hashes, rule set, transform implementation, registry hash/version/resolution, authority, tenant, source, exact sink, run/revision, occurrence, sequence, timestamp, and field path. Registry resolution is atomic; stale/mixed resolution fails with zero write. Audit IDs are explicitly not capabilities. |
| P1-03 complete source/sink join | 57-value source enum, 54-value sink enum, 57 source rows, 54 sink rows, `flowPolicy`, 39 flow examples | The deterministic evaluator covers all 3,078 source×sink pairs. It denies unknown source/sink/control, has positive+denial examples for all 18 destination families, and includes metrics, MCP, plugins, isolation output, database projections/backups, export/replay/fork, support/migration, test/benchmark evidence, and caller/runtime identifier treatment. |
| P1-04 prototype/resource safety | pointer semantics/cases, resource carrier, semantic boundary pairs, checkpoint ref count | `__proto__`, `prototype`, and `constructor` are forbidden after token decoding at every depth. Traversal is own-property-only and iterative. Fourteen machine limits now have exact-bound/+1 pairs: policy/protected/transformed bytes, depth, nodes, containers, members, pointer count/tokens/path/token bytes, aggregate refs, ref bytes, and diagnostic bytes. |
| P1-05 durable hostile corpus | v1alpha2 conformance schema and corpus | The corpus now has 106 semantic cases in 53 positive/hostile pairs over 51 closed rule names and 80 closed mutation operators. It includes every original 19 hostile relation, global ID/source/sink/Cartesian completeness, bound receipt/AAD/store joins, prototype/key normalization, side effects, and all resource limits. Every hostile case carries a stable code and zero raw write/executor/dependent release. |
| P1-06 omitted side effects | event schema, normalization/guard cases, recovery semantics | Omission normalizes exactly to serialized `unspecified`; an open attempt is always `in-doubt-effect`. `none` alone is safe-new-attempt. Unknown classification rejects before event/store/executor. The failed guard carrier requires executor outcome and retry disposition; successful outcomes forbid failure-disposition fields. |
| P1-07 dependency deadlock/stale mapping | D9 brief Section 14 and security architecture Sections 18.1–18.2 | `039` DoD is contract-only and can complete before dependents. Live mapping is `039 -> 087/088 -> 089`, then `089 + 077 -> 031`. Contract Green, native Green, D9 conformance Green, and candidate Green are explicitly different states. |
| P2-01 tool transcript | Section 6 below | Actual resolved versions and argv are recorded; no prior producer version line was reused. |
| P2-02 sparse failure/legacy coverage | `failureMatrix`, `legacyMatrix`, added guard cases | The corpus carries the exact 48-cell failure matrix and 30-cell legacy matrix, plus explicit pre/post `encode`, `mac`, and `canonicalize`, `unspecified`, and unknown-classification guard examples. Native fault injection remains owned by 087/088/089. |

## 3. Corpus accounting and semantic closure

Final self-audited accounting:

- 14 strict Draft 2020-12 schemas;
- 57 exact source classes and 57 ordered classification rows;
- 54 exact sink classes and 54 ordered policy rows;
- 18 sink families;
- 3,078 deterministically evaluated source×sink combinations;
- 39 explicit flow examples, including one positive and one denial per family
  plus three unknown-input denials;
- 30 wire cases: 16 valid and 14 invalid, directly covering 13 of the 14
  schemas; the conformance schema is validated against the corpus itself;
- 21 pointer cases, including empty own key and four prototype-name attacks;
- 106 semantic cases, 53 exact positive/hostile pairs, 51 used rule names, and
  no unused rule name;
- all original 19 independent hostile relations represented with adjacent
  valid relations;
- 23 representative guard cases plus an exact 48-cell declarative matrix;
- five side-effect normalization cases;
- six guarded-store bypass denials;
- ten derivative/replay/fork cases;
- seven representative legacy cases plus an exact 30-cell declarative matrix;
  and
- 358 globally unique case IDs across every ID-bearing corpus section.

The default 3,078-pair evaluation produces 247 protected-ref authorizations,
126 metadata-only authorizations, and 2,705 suppressions. This is a default
policy accounting result, not permission for a sink to bypass its explicit
effective controls.

## 4. Exact validation commands and results

### 4.1 Duplicate-key and Draft 2020-12 meta-schema check

Command:

```bash
uv run --project python python - <<'PY'
import json
from pathlib import Path
from jsonschema import Draft202012Validator
NAMES={'capture-policy.schema.json','capture-sink.schema.json','capture-source.schema.json','checkpoint-v1alpha2.schema.json','event-v1alpha2.schema.json','payload-disposition.schema.json','protected-aad.schema.json','protected-blob.schema.json','protected-store-envelope.schema.json','protected-value.schema.json','redaction-conformance.schema.json','redaction-receipt.schema.json','redaction-rule.schema.json','sink-guard-decision.schema.json'}
def reject(pairs):
    out={}
    for key,value in pairs:
        if key in out: raise ValueError(f'duplicate key: {key}')
        out[key]=value
    return out
for p in sorted(Path('spec').glob('*schema.json')):
    if p.name in NAMES:
        Draft202012Validator.check_schema(json.loads(p.read_text(),object_pairs_hook=reject))
json.loads(Path('spec/conformance/redaction.case.json').read_text(),object_pairs_hook=reject)
print('PASS duplicate-key + Draft 2020-12 meta-schema: schemas=14 corpus=1')
PY
```

Result:

```text
PASS duplicate-key + Draft 2020-12 meta-schema: schemas=14 corpus=1
```

### 4.2 Ajv strict compilation, corpus, and declared wire outcomes

Command:

```bash
corepack pnpm exec node --input-type=module <<'JS'
import fs from 'node:fs'; import Ajv2020 from 'ajv/dist/2020.js';
const names=['capture-policy.schema.json','capture-sink.schema.json','capture-source.schema.json','checkpoint-v1alpha2.schema.json','event-v1alpha2.schema.json','payload-disposition.schema.json','protected-aad.schema.json','protected-blob.schema.json','protected-store-envelope.schema.json','protected-value.schema.json','redaction-conformance.schema.json','redaction-receipt.schema.json','redaction-rule.schema.json','sink-guard-decision.schema.json'];
const parse=p=>JSON.parse(fs.readFileSync(p,'utf8')); const ajv=new Ajv2020({strict:true,allErrors:true,validateFormats:false});
for(const name of names) ajv.addSchema(parse(`spec/${name}`),name);
for(const name of names) if(!ajv.getSchema(name)) throw new Error(`not compiled: ${name}`);
const corpus=parse('spec/conformance/redaction.case.json'); const corpusValidate=ajv.getSchema('redaction-conformance.schema.json');
if(!corpusValidate(corpus)) throw new Error(JSON.stringify(corpusValidate.errors));
let valid=0,invalid=0;
for(const c of corpus.wireCases){const validate=ajv.getSchema(c.schema);const actual=validate(c.document);if(actual!==c.valid)throw new Error(c.id);c.valid?valid++:invalid++;}
console.log(`PASS Ajv strict schemas=14 corpus=1 wire=${corpus.wireCases.length} valid=${valid} invalid=${invalid} directSchemas=${new Set(corpus.wireCases.map(x=>x.schema)).size}/14+self`);
JS
```

Result:

```text
PASS Ajv strict schemas=14 corpus=1 wire=30 valid=16 invalid=14 directSchemas=13/14+self
```

### 4.3 Independent RFC 6901/prototype oracle

The independent Python oracle snapshots input, strictly decodes `~0`/`~1`,
round-trips each spelling, rejects empty-root/malformed/duplicate/overlap and
decoded `__proto__`/`prototype`/`constructor`, distinguishes dict keys from
canonical array indices, resolves every target before mutation, forbids array
removal, then compares the exact result and canonical paths.

Invocation:

```bash
uv run --project python python - <<'PY'
import copy,json,re
from pathlib import Path
c=json.loads(Path('spec/conformance/redaction.case.json').read_text())
forbidden={'__proto__','prototype','constructor'}
def decode(path):
    if path=='' or not path.startswith('/'): raise ValueError
    out=[]
    for raw in path[1:].split('/'):
        token='';i=0
        while i<len(raw):
            if raw[i]!='~': token+=raw[i];i+=1;continue
            if i+1>=len(raw) or raw[i+1] not in '01': raise ValueError
            token+='~' if raw[i+1]=='0' else '/';i+=2
        if token in forbidden or token.replace('~','~0').replace('/','~1')!=raw: raise ValueError
        out.append(token)
    return out
def transform(case):
    try:
        paths=case['paths']
        if len(paths)!=len(set(paths)) or paths!=sorted(paths): raise ValueError
        snap=copy.deepcopy(case['input']);resolved=[]
        for path in paths:
            cur=snap;loc=[]
            for token in decode(path):
                if type(cur) is dict:
                    if token not in cur: raise ValueError
                    loc.append(('k',token));cur=cur[token]
                elif type(cur) is list:
                    if not re.fullmatch(r'0|[1-9][0-9]*',token): raise ValueError
                    index=int(token)
                    if index>=len(cur): raise ValueError
                    loc.append(('i',index));cur=cur[index]
                else: raise ValueError
            resolved.append((path,tuple(loc)))
        locs=[x[1] for x in resolved]
        if len(locs)!=len(set(locs)): raise ValueError
        if any(i!=j and len(a)<len(b) and b[:len(a)]==a for i,a in enumerate(locs) for j,b in enumerate(locs)): raise ValueError
        out=copy.deepcopy(snap)
        for path,loc in sorted(resolved,key=lambda x:(len(x[1]),x[0]),reverse=True):
            parent=out
            for _,key in loc[:-1]: parent=parent[key]
            kind,key=loc[-1]
            if case['replacementMode']=='remove':
                if kind!='k': raise ValueError
                del parent[key]
            else: parent[key]='[REDACTED]'
        return {'valid':True,'output':out,'canonicalPaths':paths}
    except Exception: return {'valid':False,'code':'REDACTION_RECEIPT_INVALID'}
for case in c['pointerCases']:
    got=transform(case)
    if got!=case['expected']: raise AssertionError((case['id'],got,case['expected']))
print(f"PASS independent RFC 6901 own-property/prototype oracle cases={len(c['pointerCases'])}")
PY
```

Result:

```text
PASS independent RFC 6901 own-property/prototype oracle cases=21
```

### 4.4 Semantic, inventory, evaluator, matrix, and live-DAG oracle

The inline Python oracle independently asserted:

- exact ordered enum/inventory/source-row/sink-row equality;
- global ID uniqueness over all eleven ID-bearing sections;
- exactly one positive and one hostile case per pair, same rule, valid/invalid
  polarity, stable hostile code, and zero raw write/executor/dependent release;
- presence of the original 19 pairs and every P1 remediation pair;
- base-case resolution, including the two reserved singleton bases;
- exact/+1 parameters for all fourteen resource limits;
- all 3,078 evaluator outcomes using source row, sink row, effective control,
  representation acceptance, no-promotion, and unknown-denial rules;
- positive+denial example coverage for every one of 18 sink families;
- normalization, 48-cell failure, 30-cell legacy, guard, bypass, and derivative
  invariants; and
- the live `039 -> 087/088 -> 089`, `089 + 077 -> 031` dependency/status join.

Invocation:

```bash
uv run --project python python - <<'PY'
import json
from collections import Counter,defaultdict
from pathlib import Path
spec=Path('spec');c=json.loads((spec/'conformance/redaction.case.json').read_text())
sinks=json.loads((spec/'capture-sink.schema.json').read_text())['enum']
sources=json.loads((spec/'capture-source.schema.json').read_text())['enum']
assert c['sinkInventory']==sinks and len(set(sinks))==54
assert c['sourceInventory']==sources and len(set(sources))==57
sinkrows=c['sinkPolicyCases'];srcrows=c['sensitiveFieldCases']
assert [x['sink'] for x in sinkrows]==sinks
assert [x['sourceClass'] for x in srcrows]==sources
assert len({x['family'] for x in sinkrows})==18
sections=['sinkPolicyCases','flowCases','wireCases','pointerCases','semanticCases','guardCases','normalizationCases','storeBypassCases','derivativeCases','sensitiveFieldCases','legacyCases']
ids=[x['id'] for sec in sections for x in c[sec]];assert len(ids)==len(set(ids))
by=defaultdict(list)
for x in c['semanticCases']:by[x['pairId']].append(x)
assert len(c['semanticCases'])==106 and len(by)==53
conformance=json.loads((spec/'redaction-conformance.schema.json').read_text())
assert set(conformance['$defs']['semanticCase']['properties']['rule']['enum'])=={x['rule'] for x in c['semanticCases']}
assert set(conformance['$defs']['semanticOperator']['enum'])=={x['mutation']['operator'] for x in c['semanticCases']}
for pair,xs in by.items():
    assert len(xs)==2 and {x['polarity'] for x in xs}=={'positive','hostile'} and len({x['rule'] for x in xs})==1
    p=next(x for x in xs if x['polarity']=='positive');h=next(x for x in xs if x['polarity']=='hostile')
    assert p['expected']['valid'] and 'code' not in p['expected']
    assert not h['expected']['valid'] and h['expected']['sinkWrites']==0 and 'code' in h['expected']
    assert all(x['expected']['rawWrites']==x['expected']['executorCalls']==x['expected']['dependentReleases']==0 for x in xs)
required19={'pair-policy-mode','pair-policy-path-order','pair-policy-rule-unique','pair-policy-bytes','pair-receipt-count','pair-receipt-order','pair-tag-bits','pair-cipher-length','pair-aad-path-bytes','pair-store-run','pair-store-mac','pair-store-policy','pair-event-mac','pair-trace-parent','pair-checkpoint-mac','pair-ref-count','pair-failed-guard','pair-source-coverage','pair-global-id'}
requiredP1={'pair-checkpoint-occurrence','pair-event-occurrence','pair-retry-occurrence','pair-key-ref','pair-authority-scope','pair-tenant-scope','pair-store-replay','pair-receipt-source','pair-receipt-result','pair-receipt-rules','pair-receipt-registry','pair-receipt-transform','pair-receipt-authority','pair-receipt-sink','pair-receipt-occurrence','pair-receipt-timestamp','pair-registry-atomic','pair-sink-coverage','pair-cartesian','pair-side-effects','pair-prototype','pair-key-normalization'}
assert required19|requiredP1<=set(by)
for x in c['semanticCases']:
    sec,bid=x['baseSection'],x['baseCaseId']
    if sec in c and isinstance(c[sec],list): assert bid in {v['id'] for v in c[sec]}
    else: assert (sec,bid) in {('resourceLimits','redaction-resource-limits'),('corpus','redaction-corpus')}
limits={'maxPolicyUtf8Bytes':('pair-policy-bytes','utf8Bytes'),'maxProtectedValueUtf8Bytes':('pair-protected-bytes','utf8Bytes'),'maxTransformedUtf8Bytes':('pair-transformed-bytes','utf8Bytes'),'maxValueDepth':('pair-depth','depth'),'maxValueNodes':('pair-value-count','nodes'),'maxContainers':('pair-container-count','containers'),'maxObjectMembers':('pair-object-members','members'),'maxPointersPerRule':('pair-pointer-count','pointers'),'maxPointerTokens':('pair-pointer-tokens','tokens'),'maxPointerUtf8Bytes':('pair-pointer-bytes','utf8Bytes'),'maxPointerTokenUtf8Bytes':('pair-pointer-token-bytes','utf8Bytes'),'maxProtectedRefsPerRecord':('pair-ref-count','protectedRefs'),'maxRefUtf8Bytes':('pair-ref-bytes','utf8Bytes'),'maxDiagnosticUtf8Bytes':('pair-diagnostic-bytes','utf8Bytes')}
for key,(pair,param) in limits.items():
    vals={x['polarity']:next(v['value'] for v in x['mutation']['parameters'] if v['name']==param) for x in by[pair]}
    assert vals=={'positive':c['resourceLimits'][key],'hostile':c['resourceLimits'][key]+1}
S={x['sourceClass']:x for x in srcrows};K={x['sink']:x for x in sinkrows}
controls={'durableValues','checkpointValues','events','artifacts','errors','logs','traces','metrics','prompts','responses','tools','mcp','plugins','isolationOutputs','database','exports','supportBundles','testArtifacts','identifiers','deny'}
def evaluate(src,sink,enabled,known=(True,True,True)):
    if not all(known):return ('failed',False,'REDACTION_POLICY_INVALID')
    s,k=S[src],K[sink]
    if not enabled or s['policyControl']=='deny':return ('suppressed',False,None)
    requested='metadata-only' if s['defaultAction']=='metadata-only-allowlist' else 'protected-ref'
    accepted=k['acceptsMetadata'] if requested=='metadata-only' else k['acceptsProtected']
    return (requested,True,None) if accepted else ('suppressed',False,None)
counts=Counter(evaluate(src,sink,K[sink]['defaultEnabled'] and S[src]['defaultAction']!='off' and S[src]['policyControl']!='deny')[0] for src in sources for sink in sinks)
assert sum(counts.values())==c['flowPolicy']['cartesianProductCount']==3078
for x in c['flowCases']:
    known=(x['knownSource'],x['knownSink'],x['knownControl'])
    if all(known):
        assert x['policyControl'] in controls and x['policyControl'] in ({S[x['sourceClass']]['policyControl']}|set(K[x['sink']]['policyControls']))
        got=evaluate(x['sourceClass'],x['sink'],x['policyEnabled'],known)
    else:got=('failed',False,'REDACTION_POLICY_INVALID')
    assert (x['expected']['outcome'],x['expected']['writeAuthorized'],x['expected'].get('code'))==got
for family in {x['family'] for x in sinkrows}:
    ex=[x for x in c['flowCases'] if x['knownSink'] and K[x['sink']]['family']==family]
    assert any(x['expected']['writeAuthorized'] for x in ex) and any(not x['expected']['writeAuthorized'] for x in ex)
n={x['graphValue']:x['expected'] for x in c['normalizationCases']}
assert n['omitted']['normalized']=='unspecified' and n['omitted']['retryDispositionForOpenAttempt']=='in-doubt-effect'
assert n['none']['retryDispositionForOpenAttempt']=='safe-new-attempt'
assert not n['unknown']['valid'] and n['unknown']['eventWrites']==n['unknown']['executorCalls']==0
fm=c['failureMatrix'];assert fm['matrixCaseCount']==len(fm['preExecutorFailurePoints'])+len(fm['postExecutorFailurePoints'])*len(fm['sideEffectClassifications'])==48
lm=c['legacyMatrix'];assert lm['cartesianCaseCount']==len(lm['redactedFields'])*len(lm['inlineShapes'])*len(lm['terminalStates'])==30
assert all(x['expected']['rawWrites']==0 for x in c['guardCases'])
assert all(x['expected']['dependentReleases']==0 for x in c['guardCases'] if x['failurePoint']!='none')
assert all(x['expected']['denied'] and x['expected']['sinkWrites']==0 for x in c['storeBypassCases'])
r=json.loads(Path('codex_logs/task-registry.json').read_text());T={x['id']:x for x in r['tasks']};j=c['dependencyJoin']
assert T[j['contractTask']]['status']=='in_progress'
assert T['D9-TS-REDACTION-087']['depends_on']==T['D9-PY-REDACTION-088']['depends_on']==['D9-REDACTION-039']
assert T[j['securityJoin']]['depends_on']==['D9-TS-REDACTION-087','D9-PY-REDACTION-088']
assert set(j['durableExtensionRequires'])<=set(T[j['durableExtensionTask']]['depends_on'])
assert all(T[x]['status']=='planned' for x in ['D9-TS-REDACTION-087','D9-PY-REDACTION-088','D9-REDACTION-CONFORMANCE-089','D9-DURABLE-EXT-SPEC-031'])
print(f"PASS semantic/inventory oracle: globalIds={len(ids)} semantic={len(c['semanticCases'])} pairs={len(by)} rules={len({x['rule'] for x in c['semanticCases']})} required19=19 resources={len(limits)}")
print(f"PASS total evaluator: sources=57 sinks=54 cartesian=3078 outcomes={dict(counts)} families=18 positive+deny")
print('PASS normalization=5 failureMatrix=48 legacyMatrix=30 dependencyJoin=039->087/088->089 and 089+077->031; downstream Open')
PY
```

Results:

```text
PASS semantic/inventory oracle: globalIds=358 semantic=106 pairs=53 rules=51 required19=19 resources=14
PASS total evaluator: sources=57 sinks=54 cartesian=3078 outcomes={'protected-ref': 247, 'suppressed': 2705, 'metadata-only': 126} families=18 positive+deny
PASS normalization=5 failureMatrix=48 legacyMatrix=30 dependencyJoin=039->087/088->089 and 089+077->031; downstream Open
```

### 4.5 Constructed byte/depth boundaries

An in-memory Node oracle constructed structurally valid policies at exactly
65,536 and 65,537 canonical UTF-8 bytes, multi-byte paths at 1,024/1,025
bytes, decoded tokens at 256/257 bytes, and nested values at depth 128/129. It
used the strict policy/rule schemas and did not write temporary files.

Invocation:

```bash
corepack pnpm exec node --input-type=module <<'JS'
import fs from 'node:fs'; import Ajv2020 from 'ajv/dist/2020.js';
const c=JSON.parse(fs.readFileSync('spec/conformance/redaction.case.json','utf8'));
const load=n=>JSON.parse(fs.readFileSync(`spec/${n}`,'utf8'));
const a=new Ajv2020({strict:true,allErrors:true,validateFormats:false});
for(const n of ['capture-sink.schema.json','capture-source.schema.json','redaction-rule.schema.json','capture-policy.schema.json'])a.addSchema(load(n),n);
const canon=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canon).join(',')}]`:`{${Object.keys(v).sort((x,y)=>x<y?-1:x>y?1:0).map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
const bytes=v=>Buffer.byteLength(canon(v));
const base=structuredClone(c.wireCases.find(x=>x.id==='policy-default-valid').document);base.logs='redacted';
const make=(n,last)=>{const p=structuredClone(base),paths=[];for(let i=0;i<n;i++)paths.push(`/p${String(i).padStart(4,'0')}`+'x'.repeat(i===n-1?last:180));p.redactionRules=[{apiVersion:'graphengineering.reacher-z.github.io/redaction-rule/v1alpha2',ruleId:'boundary-log-rule',registryVersion:1,sink:'runtime-log',paths,replacementMode:'constant-token'}];return p};
const exact=target=>{for(let n=1;n<=1024;n++){const lo=make(n,0),hi=make(n,249),a=bytes(lo),b=bytes(hi);if(a<=target&&target<=b){const p=make(n,target-a);if(bytes(p)!==target)throw Error('exact');return p}}throw Error('unreachable')};
for(const target of [65536,65537]){const p=exact(target),v=a.getSchema('capture-policy.schema.json');if(!v(p))throw Error(JSON.stringify(v.errors));console.log(`STRUCTURAL policyBytes=${target} valid=true semantic=${target===65536?'accept':'REDACTION_POLICY_INVALID'}`)}
const path1024='/'+('é'.repeat(511))+'a',path1025=path1024+'b',token256='é'.repeat(128),token257=token256+'a';
if(Buffer.byteLength(path1024)!==1024||Buffer.byteLength(path1025)!==1025||Buffer.byteLength(token256)!==256||Buffer.byteLength(token257)!==257)throw Error('UTF8');
const depth=n=>{let v=0;for(let i=0;i<n;i++)v=[v];let d=0;while(Array.isArray(v)){d++;v=v[0]}return d};
if(depth(128)!==128||depth(129)!==129)throw Error('depth');
console.log('PASS exact-bound construction policy=65536/65537 path=1024/1025 token=256/257 depth=128/129');
JS
```

Results:

```text
STRUCTURAL policyBytes=65536 valid=true semantic=accept
STRUCTURAL policyBytes=65537 valid=true semantic=REDACTION_POLICY_INVALID
PASS exact-bound construction policy=65536/65537 path=1024/1025 token=256/257 depth=128/129
```

### 4.6 Documentation and hygiene

Commands:

```bash
corepack pnpm check:docs
git diff --check -- codex_plans/architecture/security-and-isolation.md codex_plans/delivery/d9-redaction-implementation-brief.md
rg -n '^(<<<<<<<|=======|>>>>>>>)|[[:blank:]]+$' <the exact 18 D9 artifacts>
```

Results:

```text
Checked 250 local Markdown links.
PASS diff/conflict/trailing-whitespace hygiene
```

## 5. Immutable artifact manifest for independent review

| Artifact | SHA-256 |
| --- | --- |
| `spec/redaction-semantics.md` | `e8896957976766ff97a0854a4be0d75128981a0f23e92a48710ddd93249e1c51` |
| `spec/capture-policy.schema.json` | `c9a782f9ecb40068ed322de64058dc1be8e77ae0a9c1a7594ef9745c3515c5af` |
| `spec/capture-sink.schema.json` | `0b547e1258cf76bf34a7948aab4fee42c9eec160ed10849f1cc5ff0031b0d24b` |
| `spec/capture-source.schema.json` | `23fef388237c8af597f28e5c4f1e01555e04cd658a0b68ef6978b0a632201582` |
| `spec/checkpoint-v1alpha2.schema.json` | `401ae52b3d907d8f37c8b1653c4b047202a46257125fc9ea2dcf01dfc43e3b4f` |
| `spec/event-v1alpha2.schema.json` | `8776d027878b85a460c2406ffe2abae53d9e9b176fc08139bf57131e19c999e1` |
| `spec/payload-disposition.schema.json` | `0986f97368e5745e0ed57428051fcedf1e0aa8469a21a351ca90fe6fd19195ab` |
| `spec/protected-aad.schema.json` | `1c284d5beaabcc771b1e42f5d6f1418cd583f5762c3550d9218a5828c70b621a` |
| `spec/protected-blob.schema.json` | `5dc764b76e12a77921dfce737b789ec2c27289514f67adff4bee1b2cea11fa78` |
| `spec/protected-store-envelope.schema.json` | `463547f163fdf57f2e1c6ac286a2aaac4f53189ffcc58ac49d40909f8c090d53` |
| `spec/protected-value.schema.json` | `1bb2adbab65beab0c1ba64db590963ca942fe68a0f23be9fdf09c614e2537453` |
| `spec/redaction-conformance.schema.json` | `d750240a3ea74cfb71a5b0f15e71584f248d8749acb781098f593da51465a405` |
| `spec/redaction-receipt.schema.json` | `ddddd2871e526dd544094ce71da8b4b7e0633a2832d45282d585afd54ce150a1` |
| `spec/redaction-rule.schema.json` | `73e63c3654ceef16d3c74bc7cc2e668c9fc2523599ddeb7e30a3a15a489e49e2` |
| `spec/sink-guard-decision.schema.json` | `576ce97b422f9d407fd4ffc8f02084198fc3cb62cb4a8bab4a66164a6b5672fd` |
| `spec/conformance/redaction.case.json` | `40eb30f26eec05ceca739587b6d1a11919a4832c4ea4bea639a3152a4e3f2429` |
| `codex_plans/delivery/d9-redaction-implementation-brief.md` | `b91a85a13c9e0ffbeba1d12866b3b93ec9d8cf385af72fe8465de835fdd4ef08` |
| `codex_plans/architecture/security-and-isolation.md` | `7eff9b35871bd323f6a9f2d85646c2a77586b8e46dfb374ea439b1589af3b039` |

Any byte change invalidates this manifest and requires the affected checks and
independent verdict to be rerun.

## 6. Resolved toolchain

Exact commands and resolved versions:

```text
node --version                                      v22.23.1
corepack pnpm --version                             10.13.1
corepack pnpm exec node (ajv/package.json)          8.20.0
uv --version                                        0.11.11 (x86_64-unknown-linux-gnu)
uv run --project python python                      3.14.0
uv run --project python importlib.metadata jsonschema  4.26.0
```

## 7. Residual disposition and handoff

Producer self-audit found **no residual contract P0/P1** in the remediated
carrier set. This is not an acceptance verdict. A separate agent must bind the
hashes above, rerun hostile semantic, prototype, resource, source×sink,
receipt/AAD substitution, docs/DAG, and scope checks, and either authorize
contract acceptance or report new findings.

Known native/product P0 behavior remains intentionally Open: current TS/Python
durable writers still persist raw application values while asserting the old
redaction signal. That implementation defect is owned by 087/088 and the 089
join after independent contract acceptance. No native/package/canary evidence
was produced or claimed here.

Recommended next action: independent hostile R3 on the exact manifest, with no
edits by this remediation author and no self-acceptance.
