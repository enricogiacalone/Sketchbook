"""Ricava il sottografo del connettoma usato come 'cervello della mosca'.

Input (scaricati a parte, ~130 MB, NON nel repo):
  Connectivity_783.parquet  https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/main/Connectivity_783.parquet
  Supplemental_file1_neuron_annotations.tsv
      https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv
Output: public/fly-brain/fly-brain.json + fly-brain-edges.bin (vedi CREDITS.txt)
Uso: pip install pandas pyarrow && python build_subgraph.py <cartella input> <cartella output>
"""
import sys, os, json, struct
import numpy as np, pandas as pd

src, dst = sys.argv[1], sys.argv[2]
THR, N_BRIDGE = 5, 1500
c = pd.read_parquet(os.path.join(src, 'Connectivity_783.parquet'))
a = pd.read_csv(os.path.join(src, 'Supplemental_file1_neuron_annotations.tsv'), sep='\t', low_memory=False).drop_duplicates('root_id')
A = a.set_index('root_id'); sc = A.super_class.to_dict()
cc = c[c.Connectivity >= THR]
AN = set(a.root_id[a.super_class.isin(['ascending', 'sensory_ascending'])])
DN = set(a.root_id[a.super_class == 'descending'])
inAN = cc[cc.Presynaptic_ID.isin(AN)].groupby('Postsynaptic_ID').Connectivity.sum()
outDN = cc[cc.Postsynaptic_ID.isin(DN)].groupby('Presynaptic_ID').Connectivity.sum()
br = pd.concat([inAN.rename('i'), outDN.rename('o')], axis=1).dropna()
br = br[[sc.get(x) == 'central' for x in br.index]]
br['score'] = np.sqrt(br.i * br.o)
B = list(br.sort_values('score', ascending=False).index[:N_BRIDGE])
key = lambda r: (str(A.cell_type.get(r)), r)
ANl, DNl = sorted(AN, key=key), sorted(DN, key=key)
order = ANl + B + DNl
idx = {r: i for i, r in enumerate(order)}
e = cc[cc.Presynaptic_ID.isin(idx) & cc.Postsynaptic_ID.isin(idx)]
pre = e.Presynaptic_ID.map(idx).values.astype(np.int32)
post = e.Postsynaptic_ID.map(idx).values.astype(np.int32)
w = (e.Excitatory * e.Connectivity).values.astype(np.int16)
o = np.argsort(post, kind='stable'); pre, post, w = pre[o], post[o], w[o]
s = lambda v: '' if pd.isna(v) else str(v)
neurons = [{'id': str(r), 'role': 0 if i < len(ANl) else (1 if i < len(ANl) + len(B) else 2),
            'type': s(A.cell_type.get(r)) or s(A.hemibrain_type.get(r)), 'cls': s(A.super_class.get(r)),
            'side': s(A.side.get(r)), 'nt': s(A.top_nt.get(r))} for i, r in enumerate(order)]
meta = {'source': 'FlyWire FAFB v783', 'threshold_synapses': THR,
        'counts': {'afferent_ascending': len(ANl), 'intrinsic_bridge': len(B), 'efferent_descending': len(DNl)},
        'edges': int(len(w)), 'weight': 'signed synapse count', 'edge_order': 'sorted by post'}
os.makedirs(dst, exist_ok=True)
json.dump({'meta': meta, 'neurons': neurons}, open(os.path.join(dst, 'fly-brain.json'), 'w'), separators=(',', ':'))
with open(os.path.join(dst, 'fly-brain-edges.bin'), 'wb') as f:
    f.write(struct.pack('<4sI', b'FLYE', len(w))); f.write(pre.tobytes()); f.write(post.tobytes()); f.write(w.tobytes())
print(meta)
