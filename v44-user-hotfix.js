(() => {
  function userWorkSearchMatches(hay,tokens){
    return tokens.every(token=>hay.includes(token));
  }

  function userWorkFallbackToken(tokens){
    let best="";
    for(const token of tokens){
      if(token.length>=best.length)best=token;
    }
    return best;
  }

  window.userWorkSearchMatches=userWorkSearchMatches;
  window.userWorkFallbackToken=userWorkFallbackToken;

  userWorkRows=function(){
    const q=searchKey(libraryQuery);
    const tokens=q.split(/\s+/).filter(Boolean);
    let rows=libraryCache.filter(row=>String(row.preference_state||"normal")!=="hidden");
    if(!tokens.length)return rows;

    const mapped=rows.map((row,index)=>({row,index,hay:userWorkSearchKey(row)}));
    const strict=mapped.filter(item=>userWorkSearchMatches(item.hay,tokens));
    let selected=strict;
    let rankQ=q;
    let rankTokens=tokens;

    if(!strict.length&&tokens.length>1){
      const fallback=userWorkFallbackToken(tokens);
      if(fallback){
        selected=mapped.filter(item=>item.hay.includes(fallback));
        rankQ=fallback;
        rankTokens=[fallback];
      }
    }

    return selected
      .map(item=>({...item,rank:userWorkSearchRank(item.row,rankQ,rankTokens)}))
      .sort((a,b)=>a.rank-b.rank||a.index-b.index)
      .map(item=>item.row);
  };

  const userWorkSearch=document.querySelector("#userWorkSearch");
  if(userWorkSearch){
    userWorkSearch.addEventListener("input",e=>{
      if(!e.isComposing)return;
      libraryQuery=String(e.target.value||"").trim();
      userWorkMarketLimit=8;
      userWorkMineLimit=12;
      renderUserWorkHome();
    });
  }
})();
