use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettings {
   pub model: Option<String>,
   pub preview_enabled: Option<bool>,
   pub reasoning_effort: Option<String>,
}

/// Get the home directory
fn get_home_dir() -> Option<PathBuf> {
   dirs::home_dir()
}

/// Check if file is TOML based on extension
fn is_toml_file(path: &str) -> bool {
   path.ends_with(".toml")
}

/// Read agent settings from the agent's config file
#[command]
pub async fn get_agent_settings(
   agent_id: String,
   settings_path: String,
   model_key: String,
   preview_key: Option<String>,
   reasoning_key: Option<String>,
) -> Result<AgentSettings, String> {
   let home = get_home_dir().ok_or("Could not find home directory")?;
   let full_path = home.join(&settings_path);

   if !full_path.exists() {
      return Ok(AgentSettings {
         model: None,
         preview_enabled: None,
         reasoning_effort: None,
      });
   }

   let content = std::fs::read_to_string(&full_path)
      .map_err(|e| format!("Failed to read settings file: {}", e))?;

   // Parse based on file type
   let json: Value = if is_toml_file(&settings_path) {
      // Parse TOML and convert to JSON Value
      let toml_value: toml::Value =
         toml::from_str(&content).map_err(|e| format!("Failed to parse TOML: {}", e))?;
      toml_to_json(toml_value)
   } else {
      serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON: {}", e))?
   };

   // Extract model value using dot notation (e.g., "model.name")
   let model = get_nested_value(&json, &model_key).and_then(|v| v.as_str().map(String::from));

   // Extract preview value if key provided
   let preview_enabled = preview_key
      .as_ref()
      .and_then(|key| get_nested_value(&json, key))
      .and_then(|v| v.as_bool());

   // Extract reasoning effort if key provided
   let reasoning_effort = reasoning_key
      .as_ref()
      .and_then(|key| get_nested_value(&json, key))
      .and_then(|v| v.as_str().map(String::from));

   log::info!(
      "Read agent settings for {}: model={:?}, preview={:?}, reasoning={:?}",
      agent_id,
      model,
      preview_enabled,
      reasoning_effort
   );

   Ok(AgentSettings {
      model,
      preview_enabled,
      reasoning_effort,
   })
}

/// Update agent settings in the agent's config file
#[command]
pub async fn set_agent_settings(
   agent_id: String,
   settings_path: String,
   model_key: String,
   preview_key: Option<String>,
   reasoning_key: Option<String>,
   model: Option<String>,
   preview_enabled: Option<bool>,
   reasoning_effort: Option<String>,
) -> Result<(), String> {
   let home = get_home_dir().ok_or("Could not find home directory")?;
   let full_path = home.join(&settings_path);
   let is_toml = is_toml_file(&settings_path);

   // Ensure parent directory exists
   if let Some(parent) = full_path.parent() {
      std::fs::create_dir_all(parent)
         .map_err(|e| format!("Failed to create settings directory: {}", e))?;
   }

   // Read existing settings or create new object
   let mut json: Value = if full_path.exists() {
      let content = std::fs::read_to_string(&full_path)
         .map_err(|e| format!("Failed to read settings file: {}", e))?;

      if is_toml {
         let toml_value: toml::Value =
            toml::from_str(&content).unwrap_or(toml::Value::Table(toml::map::Map::new()));
         toml_to_json(toml_value)
      } else {
         serde_json::from_str(&content).unwrap_or(Value::Object(serde_json::Map::new()))
      }
   } else {
      Value::Object(serde_json::Map::new())
   };

   // Update model value
   if let Some(model_value) = model {
      set_nested_value(&mut json, &model_key, Value::String(model_value));
   }

   // Update preview value if key provided
   if let (Some(key), Some(preview)) = (preview_key, preview_enabled) {
      set_nested_value(&mut json, &key, Value::Bool(preview));
   }

   // Update reasoning effort if key provided
   if let (Some(key), Some(reasoning)) = (reasoning_key, reasoning_effort) {
      set_nested_value(&mut json, &key, Value::String(reasoning));
   }

   // Write back to file
   let content = if is_toml {
      let toml_value = json_to_toml(json);
      toml::to_string_pretty(&toml_value).map_err(|e| format!("Failed to serialize TOML: {}", e))?
   } else {
      serde_json::to_string_pretty(&json).map_err(|e| format!("Failed to serialize JSON: {}", e))?
   };

   std::fs::write(&full_path, content)
      .map_err(|e| format!("Failed to write settings file: {}", e))?;

   log::info!("Updated agent settings for {}", agent_id);

   Ok(())
}

/// Helper to get a nested value using dot notation
fn get_nested_value<'a>(json: &'a Value, key: &str) -> Option<&'a Value> {
   let parts: Vec<&str> = key.split('.').collect();
   let mut current = json;

   for part in parts {
      current = current.get(part)?;
   }

   Some(current)
}

/// Helper to set a nested value using dot notation
fn set_nested_value(json: &mut Value, key: &str, value: Value) {
   let parts: Vec<&str> = key.split('.').collect();

   if parts.is_empty() {
      return;
   }

   let mut current = json;

   // Navigate to parent, creating objects as needed
   for part in &parts[..parts.len() - 1] {
      if !current.is_object() {
         *current = Value::Object(serde_json::Map::new());
      }

      let obj = current.as_object_mut().unwrap();
      if !obj.contains_key(*part) {
         obj.insert(part.to_string(), Value::Object(serde_json::Map::new()));
      }
      current = obj.get_mut(*part).unwrap();
   }

   // Set the final value
   if !current.is_object() {
      *current = Value::Object(serde_json::Map::new());
   }

   if let Some(obj) = current.as_object_mut() {
      obj.insert(parts.last().unwrap().to_string(), value);
   }
}

/// Convert TOML Value to JSON Value
fn toml_to_json(toml: toml::Value) -> Value {
   match toml {
      toml::Value::String(s) => Value::String(s),
      toml::Value::Integer(i) => Value::Number(serde_json::Number::from(i)),
      toml::Value::Float(f) => serde_json::Number::from_f64(f).map_or(Value::Null, Value::Number),
      toml::Value::Boolean(b) => Value::Bool(b),
      toml::Value::Datetime(dt) => Value::String(dt.to_string()),
      toml::Value::Array(arr) => Value::Array(arr.into_iter().map(toml_to_json).collect()),
      toml::Value::Table(table) => {
         let map: serde_json::Map<String, Value> = table
            .into_iter()
            .map(|(k, v)| (k, toml_to_json(v)))
            .collect();
         Value::Object(map)
      }
   }
}

/// Convert JSON Value to TOML Value
fn json_to_toml(json: Value) -> toml::Value {
   match json {
      Value::Null => toml::Value::String(String::new()),
      Value::Bool(b) => toml::Value::Boolean(b),
      Value::Number(n) => {
         if let Some(i) = n.as_i64() {
            toml::Value::Integer(i)
         } else if let Some(f) = n.as_f64() {
            toml::Value::Float(f)
         } else {
            toml::Value::String(n.to_string())
         }
      }
      Value::String(s) => toml::Value::String(s),
      Value::Array(arr) => toml::Value::Array(arr.into_iter().map(json_to_toml).collect()),
      Value::Object(obj) => {
         let map: toml::map::Map<String, toml::Value> =
            obj.into_iter().map(|(k, v)| (k, json_to_toml(v))).collect();
         toml::Value::Table(map)
      }
   }
}
