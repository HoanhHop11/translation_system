#!/usr/bin/env python3
"""
Script tự động inject production configs (update_config, rollback_config, restart_policy) 
vào tất cả services trong stack YAML file.
"""

import re
import sys

def inject_production_configs(yaml_content: str) -> str:
    """
    Inject update_config, rollback_config, restart_policy vào tất cả deploy sections.
    """
    # Pattern để tìm deploy sections
    # Tìm các dòng deploy: với indent, sau đó inject configs vào đúng vị trí
    
    lines = yaml_content.split('\n')
    result = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        result.append(line)
        
        # Detect "deploy:" section
        if re.match(r'^(\s+)deploy:\s*$', line):
            indent = len(line) - len(line.lstrip())
            base_indent = ' ' * indent
            config_indent = ' ' * (indent + 2)
            
            # Look ahead để xem đã có config nào chưa
            has_update_config = False
            has_rollback_config = False
            has_restart_policy = False  # Any form of restart_policy
            
            # Peek ahead 15 lines
            for j in range(i+1, min(i+20, len(lines))):
                if 'update_config:' in lines[j]:
                    has_update_config = True
                if 'rollback_config:' in lines[j]:
                    has_rollback_config = True
                if 'restart_policy:' in lines[j]:  # Check for ANY restart_policy
                    has_restart_policy = True
                # Stop if we hit another top-level key at same indent
                if re.match(r'^(\s{' + str(indent) + r'})\w+:', lines[j]) and j > i+1:
                    break
            
            # Inject configs nếu chưa có
            if not has_update_config:
                result.append(f"{config_indent}update_config: *default-update-config")
            if not has_rollback_config:
                result.append(f"{config_indent}rollback_config: *default-rollback-config")
            if not has_restart_policy:  # Skip if ANY form exists
                result.append(f"{config_indent}restart_policy: *default-restart-policy")
        
        i += 1
    
    return '\n'.join(result)

def main():
    if len(sys.argv) != 2:
        print("Usage: python inject-production-configs.py <stack-file.yml>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Inject configs
        modified_content = inject_production_configs(content)
        
        # Write back
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(modified_content)
        
        print(f"✅ Successfully injected production configs into {file_path}")
        print("   - update_config: *default-update-config")
        print("   - rollback_config: *default-rollback-config")
        print("   - restart_policy: *default-restart-policy")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
