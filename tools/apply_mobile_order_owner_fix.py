from pathlib import Path

p = Path("taphoa-workspace-feedback.js")
s = p.read_text("utf-8")

old = '  let customerReassignBusy=false;\n'
new = '  let customerReassignBusy=false;\n  let mobileOrderTap=null;\n'
if old not in s:
    raise SystemExit("state marker not found")
s = s.replace(old, new, 1)

old = '''    const scroll=workspace.querySelector(".order-index-scroll");
    const sourceSummary=list.querySelector(":scope > .order-source-summary");
    const sourceDrill=list.querySelector(":scope > .order-source-detail");
    if(scroll&&(sourceSummary||sourceDrill)){
      const report=document.createElement("details");
      report.className="order-source-report";
      report.innerHTML='<summary>Theo nguồn</summary><div class="order-source-report-body"></div>';
      const body=report.querySelector(".order-source-report-body");
      if(sourceSummary)body?.appendChild(sourceSummary);
      if(sourceDrill)body?.appendChild(sourceDrill);
      scroll.insertBefore(report,scroll.firstChild);
    }
'''
new = '''    const scroll=workspace.querySelector(".order-index-scroll");
    const resultsOwner=source.closest(".order-report-results")||list;
    const sourceSummary=resultsOwner.querySelector(":scope > .order-source-summary");
    const sourceDrill=resultsOwner.querySelector(":scope > .order-source-detail");
    if(scroll&&(sourceSummary||sourceDrill)){
      const report=document.createElement("details");
      report.className="order-source-report";
      report.open=!window.matchMedia("(min-width:1000px)").matches;
      report.innerHTML='<summary>Theo nguồn</summary><div class="order-source-report-body"></div>';
      const body=report.querySelector(".order-source-report-body");
      if(sourceSummary)body?.appendChild(sourceSummary);
      if(sourceDrill)body?.appendChild(sourceDrill);
      scroll.insertBefore(report,scroll.firstChild);
    }
'''
if old not in s:
    raise SystemExit("source owner block not found")
s = s.replace(old, new, 1)

old = '''  document.addEventListener("click",event=>{
    const listItem=event.target?.closest?.("[data-order-list-item]");
    if(listItem){
      event.preventDefault();
      event.stopImmediatePropagation();
      orderWorkspaceSelectedId=String(listItem.dataset.orderId||"");
      renderOrderWorkspaceSelection();
      return;
    }
'''
new = '''  function selectOrderWorkspaceItem(listItem){
    if(!listItem)return false;
    const id=String(listItem.dataset.orderId||"");
    if(!id)return false;
    orderWorkspaceSelectedId=id;
    renderOrderWorkspaceSelection();
    return true;
  }
  function beginMobileOrderTap(event){
    if(!window.matchMedia("(max-width:999px)").matches)return;
    if(event.pointerType&&event.pointerType!=="touch"&&event.pointerType!=="pen")return;
    const target=event.target?.closest?.("[data-order-list-item]");
    if(!target)return;
    mobileOrderTap={pointerId:event.pointerId,target,x:event.clientX,y:event.clientY,at:performance.now()};
  }
  function finishMobileOrderTap(event){
    const tap=mobileOrderTap;
    mobileOrderTap=null;
    if(!tap||tap.pointerId!==event.pointerId||!tap.target.isConnected)return;
    if(Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>10||performance.now()-tap.at>800)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectOrderWorkspaceItem(tap.target);
  }
  document.addEventListener("pointerdown",beginMobileOrderTap,true);
  document.addEventListener("pointerup",finishMobileOrderTap,true);
  document.addEventListener("pointercancel",()=>{mobileOrderTap=null;},true);

  document.addEventListener("click",event=>{
    const listItem=event.target?.closest?.("[data-order-list-item]");
    if(listItem){
      event.preventDefault();
      event.stopImmediatePropagation();
      selectOrderWorkspaceItem(listItem);
      return;
    }
'''
if old not in s:
    raise SystemExit("order click block not found")
s = s.replace(old, new, 1)

p.write_text(s, "utf-8")
