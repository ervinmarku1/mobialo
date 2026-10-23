/* Shared, deterministic catalog selection. Missing data never matches a minimum. */
/* For a country page (home = its code), the default price order lists that country's own plans first,
   so the first plan matches the card's 'from' price. `covered` names the countries a plan counts for
   (the store passes the named ones, so an unnamed supplier code does not make a plan regional). */
globalThis.MobialoCatalogFilter = (plans, filters = {}, home = null, covered = p => p.countries) => {
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
  const regional = p => {const codes = covered(p);return home && !filters.sort && !(codes.length === 1 && codes[0] === home) ? 1 : 0;};
  return result.sort((a,b)=>regional(a.plan)-regional(b.plan) || (filters.sort==='data'||filters.sort==='days'?-1:1)*(value(a.plan)-value(b.plan)) || a.plan.title.localeCompare(b.plan.title));
};
