from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'order-management.js'
text = PATH.read_text('utf-8')


def replace_once(old: str, new: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one match, got {count}: {old[:90]!r}')
    text = text.replace(old, new, 1)


replace_once(
'''  async function loadDebtDetail(customerId){
    const data=await orderFetch("/debts/"+encodeURIComponent(customerId),{method:"GET"});
    debtCustomerId=String(data?.customer?.id||customerId||"");
    debtDetail=data;
    return data;
  }''',
'''  async function loadDebtDetail(customerId){
    const data=await orderFetch("/debts/"+encodeURIComponent(customerId),{method:"GET"});
    debtDetail=data;
    return data;
  }'''
)

replace_once(
'''  async function openDebtLinkedOrder(id){
    const data=await orderFetch("/orders/"+encodeURIComponent(id),{method:"GET"});
    debtLinkedOrder=data?.order||null;
    if(debtLinkedOrder)orders=[debtLinkedOrder,...orders.filter(row=>String(row.id)!==String(debtLinkedOrder.id))];
    renderDebtLinkedOrder();
  }''',
'''  async function openDebtLinkedOrder(id){
    const requestedDebtCustomerId=String(debtCustomerId||"");
    const data=await orderFetch("/orders/"+encodeURIComponent(id),{method:"GET"});
    if(activeView!=="debts"||String(debtCustomerId||"")!==requestedDebtCustomerId)return;
    debtLinkedOrder=data?.order||null;
    if(debtLinkedOrder)orders=[debtLinkedOrder,...orders.filter(row=>String(row.id)!==String(debtLinkedOrder.id))];
    renderDebtLinkedOrder();
  }'''
)

old_submit = '''    busy=true;
    try{
      await orderFetch("/debts/"+encodeURIComponent(customerId)+"/payments",{
        method:"POST",body:JSON.stringify({amountVnd:Math.round(amountVnd),note})
      });
      await loadDebtDetail(customerId);
      renderDebtDetail();
    }catch(error){'''
new_submit = '''    const requestedDebtCustomerId=String(debtCustomerId||"");
    busy=true;
    try{
      await orderFetch("/debts/"+encodeURIComponent(customerId)+"/payments",{
        method:"POST",body:JSON.stringify({amountVnd:Math.round(amountVnd),note})
      });
      await loadDebtDetail(customerId);
      if(activeView!=="debts"||String(debtCustomerId||"")!==requestedDebtCustomerId)return;
      renderDebtDetail();
    }catch(error){'''
replace_once(old_submit, new_submit)

PATH.write_text(text, 'utf-8')
print('Applied debt-detail async view ownership guards')
