ops_path = "backend/services/agent_handlers/file_ops.py"
with open(ops_path, "r", encoding="utf-8") as f:
    content = f.read()

# Обновляем системный промпт, чтобы агент умел вызывать delete_file
old_prompt_part = 'f\'You are editing the file "{target_file}" in project "{task.project_name}".\\n\''
new_prompt_part = f'''f'You are managing files in project "{{task.project_name}}".\\n'
                'You have access to tools. If the user wants to DELETE a file, you MUST output a tool call:\\n'
                '<tool_call name="delete_file">{{"filepath": "{target_file}"}}</tool_call>\\n'
                'If modifying/creating, output the raw code as usual.\\n''''

# Добавим парсинг tool calls перед сохранением файлов в file_ops.py
print("Патч подготовлен.")
