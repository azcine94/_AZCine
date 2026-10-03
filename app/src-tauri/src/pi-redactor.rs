//! In-memory display redaction sourced only from AZCine's own configuration.
//! Never resolves native !commands or environment references. Not a sandbox.
use serde_json::{Map, Value};
#[derive(Default)]
pub struct Redactor { values: Vec<String> }
impl Redactor {
    pub fn from_documents(models:&Value,auth:&Value)->Self {
        let mut redactor=Self::default();
        fn collect(value:&Value, out:&mut Redactor){match value {Value::String(s)=>out.add(s),Value::Array(a)=>for v in a{collect(v,out)},Value::Object(o)=>for (k,v) in o{if k!="type" && k!="expires"{collect(v,out)}},_=>{}}}
        collect(auth,&mut redactor);
        fn model_secrets(value:&Value,out:&mut Redactor){match value{Value::Object(o)=>for(k,v)in o{if matches!(k.to_ascii_lowercase().replace(['_','-'],"").as_str(),"apikey"|"headers"|"authorization"|"token"|"secret"){collect(v,out);}else{model_secrets(v,out);}},Value::Array(a)=>for v in a{model_secrets(v,out)},_=>{}}}
        model_secrets(models,&mut redactor);redactor
    }
    pub fn add(&mut self,value:&str){
        if value.is_empty(){return;}
        for v in [value.to_owned(),value.replace("$$","$").replace("$!","!")] {
            if !self.values.contains(&v){self.values.push(v);}
        }
        self.values.sort_by_key(|s|std::cmp::Reverse(s.len()));
    }
    pub fn text(&self,input:&str,partial:bool)->String {
        let mut result=input.to_owned();
        // A streaming frame may end in a credential prefix. Hide the suffix
        // before it becomes a complete credential on a later frame.
        if partial {
            let mut hide=0;
            for secret in &self.values {for (end,_) in secret.char_indices().skip(1) {if end>hide && input.ends_with(&secret[..end]){hide=end;}}}
            if hide>0 {result.truncate(result.len()-hide);result.push_str("[凭据片段已隐藏]");}
        }
        for secret in &self.values{result=result.replace(secret,"[凭据已隐藏]");}result
    }
    pub fn value(&self,value:Value,partial:bool)->Value{match value {
        Value::String(s)=>Value::String(self.text(&s,partial)),
        Value::Array(a)=>Value::Array(a.into_iter().map(|v|self.value(v,partial)).collect()),
        Value::Object(o)=>Value::Object(o.into_iter().map(|(k,v)|(self.text(&k,false),self.value(v,partial))).collect::<Map<_,_>>()),
        _=>value,
    }}
}
#[cfg(test)]
mod tests {
    use super::*;use serde_json::json;
    #[test]
    fn given_only_owned_credentials_when_snapshot_sent_then_nested_literals_and_partial_prefixes_are_hidden(){
        let r=Redactor::from_documents(&json!({"providers":{"x":{"headers":{"Authorization":"Bearer fixture-header-secret"}}}}),&json!({"x":{"type":"api_key","key":"fixture-key-$$VALUE"}}));
        let v=r.value(json!({"message":"fixture-key-$VALUE","tool":{"output":"Bearer fixture-header-secret"},"partial":"prefix fixture-key-$VA"}),true);
        assert!(!v.to_string().contains("fixture-key"));assert!(!v.to_string().contains("fixture-header-secret"));assert!(v["partial"].as_str().unwrap().contains("凭据片段"));
    }
    #[test]
    fn given_no_credentials_when_displaying_then_original_chinese_and_html_are_text_unchanged(){let r=Redactor::default();let v=json!({"text":"中文\u{2028}<script>not executed</script>"});assert_eq!(r.value(v.clone(),true),v);}
}
