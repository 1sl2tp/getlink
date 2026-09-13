(()=>{
  "use strict";

  const API_BASE=String(window.GETLINK_API_BASE||"").replace(/\/$/,"");
  const API_KEY=String(window.GETLINK_API_KEY||"");
  const titleEl=document.getElementById("priceTitle");
  const metaEl=document.getElementById("priceMeta");
  const rowsEl=document.getElementById("priceRows");
  const statusEl=document.getElementById("priceStatus");
  const searchEl=document.getElementById("priceSearch");

  const params=new URLSearchParams(location.search);
  const scope=params.get("scope")==="group"?"group":"all";
  const groupName=(params.get("name")||"").trim();
  let visibleRows=[];

  function norm(value){
    return String(value||"")
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/đ/gi,"d").toLowerCase().replace(/\s+/g," ").trim();
  }

  function formatVnd(value){
    const n=Math.max(0,Math.round(Number(value)||0));
    return new Intl.NumberFormat("vi-VN",{maximumFractionDigits:0}).format(n);
  }

  function formatTime(value){
    const d=new Date(value||"");
    if(!Number.isFinite(d.getTime()))return "";
    return new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(d);
  }

  function unitLabel(row){
    return String(row.packaging||row.supplier_primary_packaging||row.pack_unit||"").trim();
  }

  function showStatus(text){
    statusEl.textContent=text;
    statusEl.hidden=!text;
  }

  function makeRow(row){
    const article=document.createElement("article");
    article.className="price-row";
    article.dataset.code=row.code;

    const code=document.createElement("div");
    code.className="price-code";
    code.textContent=row.code;

    const main=document.createElement("div");
    main.className="price-main";
    const name=document.createElement("div");
    name.className="price-name";
    name.textContent=row.name;
    const sub=document.createElement("div");
    sub.className="price-sub";
    const updated=formatTime(row.updatedAt);
    sub.textContent=updated?`Cập nhật ${updated}`:"";
    main.append(name,sub);

    const price=document.createElement("div");
    price.className="price-value";
    price.textContent=formatVnd(row.priceVnd);
    const unit=unitLabel(row.raw);
    if(unit){
      const unitEl=document.createElement("span");
      unitEl.className="price-unit";
      unitEl.textContent=unit;
      price.append(unitEl);
    }

    article.append(code,main,price);
    return article;
  }

  function render(){
    const q=norm(searchEl.value);
    const rows=q?visibleRows.filter(row=>norm(`${row.code} ${row.name}`).includes(q)):visibleRows;
    rowsEl.replaceChildren(...rows.map(makeRow));
    metaEl.textContent=`${rows.length} / ${visibleRows.length} mặt hàng`;
    showStatus(rows.length?"":"Không có mặt hàng phù hợp.");
  }

  async function load(){
    if(!API_BASE||!API_KEY){
      showStatus("Chưa cấu hình kết nối bảng giá.");
      metaEl.textContent="";
      return;
    }
    const res=await fetch(`${API_BASE}/api/library?view=search&limit=10000`,{
      headers:{apikey:API_KEY},
      cache:"no-store",
    });
    if(!res.ok)throw new Error(`price_list_http_${res.status}`);
    const payload=await res.json();
    const all=(Array.isArray(payload?.products)?payload.products:[])
      .filter(row=>String(row?.source||"")==="Tạp hóa")
      .filter(row=>String(row?.last_status||"ok")!=="out_of_stock")
      .filter(row=>Number(row?.current_price||0)>=0)
      .sort((a,b)=>String(a?.name||"").localeCompare(String(b?.name||""),"vi")||String(a?.source_product_id||"").localeCompare(String(b?.source_product_id||""),"vi"))
      .map((row,index)=>({
        code:`P${String(index+1).padStart(2,"0")}`,
        productCode:String(row?.supplier_product_code||row?.source_product_id||""),
        name:String(row?.name||row?.source_name||"Sản phẩm"),
        priceVnd:Number(row?.current_price||0)||0,
        updatedAt:row?.updated_at||row?.last_checked_at||"",
        raw:row,
      }));

    if(scope==="group"&&groupName){
      const key=norm(groupName);
      visibleRows=all.filter(row=>norm(row.name).includes(key));
      titleEl.textContent=`Bảng giá ${groupName}`;
    }else{
      visibleRows=all;
      titleEl.textContent="Bảng giá toàn bộ";
    }
    render();
  }

  searchEl.addEventListener("input",render);
  load().catch(error=>{
    console.error("price_list_load_failed",error);
    showStatus("Chưa tải được bảng giá. Chị thử mở lại giúp em nhé.");
    metaEl.textContent="";
  });
})();
