// Call only AFTER Supabase /auth/v1/user validates this exact bearer token.
// Enrollment alone is not assurance: require aal2 in the validated JWT.
export function adminMfaError(authorization,user,env={}){
 const enrolled=user.factors?.some(f=>f.status==='verified');
 if(!enrolled&&env.ADMIN_MFA_REQUIRED!=='true')return null;
 if(!enrolled)return 'MFA_SETUP_REQUIRED';
 try{
  const jwt=authorization.slice(7).split('.');
  if(jwt.length!==3)return 'MFA_REQUIRED';
  const claims=JSON.parse(Buffer.from(jwt[1],'base64url').toString('utf8'));
  return claims.sub===user.id&&claims.aal==='aal2'&&claims.exp>Date.now()/1000?null:'MFA_REQUIRED';
 }catch{return 'MFA_REQUIRED';}
}
