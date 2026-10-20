/* Shared, deterministic catalog selection. Missing data never matches a minimum. */
globalThis.MobialoCatalogFilter = (plans, filters = {}) => {
  const gb = p => {
    const amount = Number(p.dataAmount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return p.dataUnit === 'GB' ? amount : p.dataUnit === 'MB' ? amount / 1024 : null;
  };
  const result = plans.map((plan,index)=>({plan,index})).filter(({plan:p})=>
    (!filters.provider || p.provider === filters.provider) &&
    (!filters.country || p.countries.includes(filters.country)) &&
    (!filters.data || (gb(p)!==null && gb(p)>=Number(filters.data))) &&
    (!filters.days || p.validityHours>=Number(filters.days)*24) &&
    (!filters.price || p.price<=Number(filters.price))
  );
  const value = p => filters.sort==='data' ? gb(p)??-1 : filters.sort==='days' ? p.validityHours??-1 : p.price;
  return result.sort((a,b)=>(filters.sort==='data'||filters.sort==='days'?-1:1)*(value(a.plan)-value(b.plan)) || a.plan.title.localeCompare(b.plan.title));
};
