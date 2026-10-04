from django.contrib import admin

from .models import Store


@admin.register(Store)
class StoreAdmin(admin.ModelAdmin):
	list_display = ['name', 'owner', 'is_active', 'created_at']
	list_filter = ['is_active', 'created_at']
	search_fields = ['name', 'slug', 'owner__email']
	prepopulated_fields = {'slug': ['name']}
